import { logger } from "firebase-functions";
import OpenAI from "openai";
import type { ModelUsage } from "../billing/ledger";
import { resolveModelId } from "../billing/models";
import type { ChatMessage } from "./types";

// Builds the decider's context from recent turns (oldest → newest): a compact
// transcript that ALSO marks which reaction GIF/meme the bot already sent on
// each turn, plus the flat list of those reaction titles. Feeding both to nano
// is what stops it repeating the same memes — without it, nano only sees text
// and has no idea what it already used.
export function buildDeciderContext(messages: ChatMessage[]): {
  history: string;
  recentReactions: string[];
} {
  const lines: string[] = [];
  const recentReactions: string[] = [];
  for (const m of messages) {
    const who = m.role === "agent" ? "Bot" : "User";
    const text = (m.text || "").slice(0, 300).trim();
    const titles: string[] = [];
    for (const g of m.gifs ?? []) if (g.title) titles.push(g.title);
    for (const i of m.images ?? []) {
      if (i.source === "klipy" && i.title) titles.push(i.title);
    }
    let line = `${who}: ${text || "[no text]"}`;
    if (m.role === "agent" && titles.length > 0) {
      line += ` [reaction sent: ${titles.join(", ")}]`;
      recentReactions.push(...titles);
    }
    lines.push(line);
  }
  return { history: lines.join("\n"), recentReactions };
}

// The cheap nano pre-step's verdict. Either no media, or a GIF/meme with a Klipy
// search term. `randomnessFactor` mirrors get_gif/get_meme's sampling knob.
export type MediaDecision =
  | { type: "none" }
  | { type: "gif" | "meme"; query: string; randomnessFactor: number };

// Billing record for a decider call that didn't actually hit the API (error /
// skipped). Zero tokens → zero cost, so it never charges the user.
const ZERO_NANO_USAGE: ModelUsage = {
  model: "nano",
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

// Strict JSON shape we force out of nano so parsing never depends on prose.
const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "media_decision",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["none", "gif", "meme"] },
        query: { type: ["string", "null"] },
        randomness_factor: { type: ["integer", "null"] },
      },
      required: ["type", "query", "randomness_factor"],
    },
  },
};

export function parseDecision(raw: string): MediaDecision {
  try {
    const o = JSON.parse(raw) as {
      type?: unknown;
      query?: unknown;
      randomness_factor?: unknown;
    };
    if (
      (o.type === "gif" || o.type === "meme") &&
      typeof o.query === "string" &&
      o.query.trim().length > 0
    ) {
      const rf = Number(o.randomness_factor);
      return {
        type: o.type,
        query: o.query.trim().slice(0, 100),
        randomnessFactor: Number.isInteger(rf) && rf >= 1 && rf <= 4 ? rf : 1,
      };
    }
  } catch {
    // fall through to "none"
  }
  return { type: "none" };
}

// Runs the nano media decider: given the assembled decider system prompt plus a
// compact history and the latest user message, returns whether to attach a
// reaction GIF/meme and the search term. Never throws — any failure (API error,
// bad JSON) resolves to "none" so the turn still produces a normal reply. Always
// reports usage so the orchestrator can bill the nano call alongside the reply.
export async function decideMedia(args: {
  apiKey: string;
  systemPrompt: string;
  history: string;
  currentMessage: string;
  // Reaction titles already sent recently (from buildDeciderContext). Surfaced
  // as an explicit "do not repeat" list so nano varies its picks.
  recentReactions?: string[];
  signal?: AbortSignal;
}): Promise<{ decision: MediaDecision; usage: ModelUsage }> {
  try {
    const client = new OpenAI({ apiKey: args.apiKey });
    const avoid =
      args.recentReactions && args.recentReactions.length > 0
        ? `\n\nReactions ALREADY sent recently — do NOT repeat these or pick anything near-identical, vary it up:\n${args.recentReactions.join(", ")}`
        : "";
    const userContent =
      (args.history ? `Conversation so far:\n${args.history}\n\n` : "") +
      `Latest user message:\n${args.currentMessage || "[no text — the user sent only an attachment]"}` +
      avoid;

    const completion = await client.chat.completions.create(
      {
        model: resolveModelId("nano"),
        // Reasoning model: max_completion_tokens covers reasoning + the tiny JSON
        // verdict. Low effort + real headroom (matching the title model) so the
        // reasoning pass can't starve the decision into an empty/length finish.
        reasoning_effort: "low",
        max_completion_tokens: 1000,
        response_format: RESPONSE_FORMAT,
        messages: [
          { role: "system", content: args.systemPrompt },
          { role: "user", content: userContent },
        ],
      },
      { signal: args.signal },
    );

    const u = completion.usage;
    const usage: ModelUsage = {
      model: "nano",
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
    return { decision: parseDecision(raw), usage };
  } catch (err) {
    logger.warn("[decideMedia] failed; defaulting to no media", { err });
    return { decision: { type: "none" }, usage: ZERO_NANO_USAGE };
  }
}
