import { logger } from "firebase-functions";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ReasoningEffort } from "openai/resources/shared";
import type { ModelUsage } from "../billing/ledger";
import { resolveModelId } from "../billing/models";

// ── Web-search router (nano) ──────────────────────────────────────────────────
// A cheap pre-step that runs in PARALLEL with the media decider. It reads the
// user's (often brainrot) message + a little context and decides whether the
// reply needs LIVE web data — and, if so, rewrites the raw message into a clean
// search-engine query. The reply model has a fixed training cutoff and no live
// data, so without this it hallucinates or hedges on real-world/recent questions.
//
// Output is strict JSON: { search: boolean, query: string|null }. Mirrors
// decideMedia's shape: a config constant, a pure message builder + parser (so
// they're unit-testable without a network call), and a never-throw runner that
// always reports usage so the orchestrator can bill the nano call.

// The router's verdict.
export type WebSearchDecision =
  | { search: false }
  | { search: true; query: string };

// Billing record for a router call that didn't hit the API (skipped / error).
// Zero tokens → zero cost, so it never charges the user.
const ZERO_ROUTER_USAGE: ModelUsage = {
  model: "gpt-5.4-nano",
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

// Strict JSON shape so parsing never depends on prose.
const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "web_search_decision",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        search: { type: "boolean" },
        query: { type: ["string", "null"] },
      },
      required: ["search", "query"],
    },
  },
};

// nano accepts "none" at the API though the pinned SDK types omit it (same cast
// decideMedia / pickBestMedia use). Drop the cast when the SDK is bumped. The
// router is a single classify-then-rewrite step, not multi-hop reasoning, so it
// runs at the model's floor for the latency win.
const ROUTER_REASONING_EFFORT = "none" as unknown as ReasoningEffort;

export const WEB_SEARCH_ROUTER_CONFIG = {
  model: resolveModelId("gpt-5.4-nano"),
  reasoning_effort: ROUTER_REASONING_EFFORT,
  max_completion_tokens: 200,
  response_format: RESPONSE_FORMAT,
} as const;

// The router system prompt. Code-canonical (not Firestore): it's a fixed
// classifier, not a persona-tuned prompt. `todayIso` is injected so it can judge
// recency ("today", "latest", "this week") against the real date.
export function buildWebSearchRouterSystemPrompt(todayIso: string): string {
  return [
    "You are the web-search router for a casual meme-chat companion app. Users",
    "talk in slangy, brainrot, lowercase shorthand. Your ONLY job: decide whether",
    "answering the user's latest message needs LIVE information the assistant",
    "cannot already know, and if so, rewrite it into a clean web-search query.",
    "",
    `Today's date is ${todayIso}. The assistant has a fixed training cutoff and no`,
    "live data, so it CANNOT know anything that happened recently or that changes",
    "over time.",
    "",
    "Set search=true ONLY when the answer genuinely depends on real-time data or",
    "facts past the training cutoff, such as:",
    "- recent or live events, scores, results, winners ('who won the thing last night')",
    "- current news, prices, stocks, crypto, weather, schedules",
    "- 'today', 'right now', 'latest', 'this week', 'currently', 'is X still ...'",
    "- specific real-world facts the user clearly wants verified and that move over time",
    "",
    "Set search=false for everything else: jokes, opinions, vibes, roasts,",
    "greetings, emotional venting, general knowledge, math, coding help, advice,",
    "and anything the assistant can already answer from its own knowledge.",
    "",
    "When search=true, rewrite the raw message into a concise, keyword-style query",
    "a search engine would handle well — strip the slang, add the implied topic and",
    "timeframe, and resolve vague references using the conversation context. For",
    "example 'yo who won the thing last night fr' about basketball becomes 'NBA",
    `Finals winner ${todayIso.slice(0, 7)}'. When search=false, set query to null.`,
    "",
    'Reply with ONLY the JSON object: {"search": true, "query": "..."} or {"search": false, "query": null}.',
  ].join("\n");
}

// Parses the router's JSON verdict. Pure + exported for unit tests. Any malformed
// / empty / search-without-query output resolves to { search: false }.
export function parseWebSearchDecision(raw: string): WebSearchDecision {
  try {
    const o = JSON.parse(raw) as { search?: unknown; query?: unknown };
    if (
      o.search === true &&
      typeof o.query === "string" &&
      o.query.trim().length > 0
    ) {
      return { search: true, query: o.query.trim().slice(0, 200) };
    }
  } catch {
    // fall through to no-search
  }
  return { search: false };
}

// Builds the router's message sequence: the system prompt, then a single user
// message carrying a short history (for reference resolution) and the latest
// message. Pure + exported so it can be unit-tested without an API call.
export function buildWebSearchRouterMessages(args: {
  todayIso: string;
  message: string;
  history?: string;
}): ChatCompletionMessageParam[] {
  const history = args.history?.trim();
  const userText =
    (history ? `Conversation so far:\n${history}\n\n` : "") +
    `Latest user message:\n${args.message}`;
  return [
    { role: "system", content: buildWebSearchRouterSystemPrompt(args.todayIso) },
    { role: "user", content: userText },
  ];
}

// Runs the web-search router (nano). Never throws — any failure (API error, bad
// JSON) resolves to { search: false } so the turn still produces a normal reply.
// Always reports usage so the orchestrator can bill the nano call.
export async function routeWebSearch(args: {
  apiKey: string;
  message: string;
  history?: string;
  todayIso?: string;
  signal?: AbortSignal;
}): Promise<{ decision: WebSearchDecision; usage: ModelUsage }> {
  const todayIso = args.todayIso ?? new Date().toISOString().slice(0, 10);
  try {
    const client = new OpenAI({ apiKey: args.apiKey });
    const completion = await client.chat.completions.create(
      {
        ...WEB_SEARCH_ROUTER_CONFIG,
        messages: buildWebSearchRouterMessages({
          todayIso,
          message: args.message,
          history: args.history,
        }),
      },
      { signal: args.signal },
    );

    const u = completion.usage;
    const usage: ModelUsage = {
      model: "gpt-5.4-nano",
      inputTokens: u?.prompt_tokens ?? 0,
      cachedInputTokens:
        (u?.prompt_tokens_details as { cached_tokens?: number } | undefined)
          ?.cached_tokens ?? 0,
      outputTokens: u?.completion_tokens ?? 0,
      reasoningTokens:
        (u?.completion_tokens_details as { reasoning_tokens?: number } | undefined)
          ?.reasoning_tokens ?? 0,
    };

    const raw = completion.choices[0]?.message?.content ?? "";
    const decision = parseWebSearchDecision(raw);

    logger.info("[routeWebSearch] telemetry", {
      search: decision.search,
      query: decision.search ? decision.query : null,
      parseFailed: raw.trim().length === 0,
    });

    return { decision, usage };
  } catch (err) {
    logger.warn("[routeWebSearch] failed; defaulting to no search", { err });
    return { decision: { search: false }, usage: ZERO_ROUTER_USAGE };
  }
}
