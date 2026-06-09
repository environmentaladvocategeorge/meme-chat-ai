import { logger } from "firebase-functions";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
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

// Builds the decider's message sequence: the decider system prompt, then the
// per-user taste memory (when present) as its own system message, then the user
// turn (text-only, or text + attachment pixels). Pure + exported so the memory
// injection and attachment handling can be unit-tested without an API call.
export function buildDeciderMessages(args: {
  systemPrompt: string;
  // Paid-gated, decider-framed taste block (see MEDIA_MEMORY_VIEW). Injected as
  // its own system message after the decider prompt — informs WHICH reaction to
  // pick, never WHETHER to attach. Omitted/empty for free users or no memory.
  memoryBlock?: string;
  history: string;
  currentMessage: string;
  recentReactions?: string[];
  imageUrls?: string[];
}): ChatCompletionMessageParam[] {
  const avoid =
    args.recentReactions && args.recentReactions.length > 0
      ? `\n\nReactions ALREADY sent recently — do NOT repeat these or pick anything near-identical, vary it up:\n${args.recentReactions.join(", ")}`
      : "";
  const imageUrls = args.imageUrls ?? [];
  const baseText =
    (args.history ? `Conversation so far:\n${args.history}\n\n` : "") +
    `Latest user message:\n${args.currentMessage || "[no text — the user sent only an attachment]"}` +
    avoid;

  // When the user attached media, hand nano the actual pixels (image and/or GIF
  // frames) as low-detail image parts so its reaction matches the content.
  // Otherwise keep the cheap text-only payload.
  const userMessage: ChatCompletionMessageParam =
    imageUrls.length > 0
      ? {
          role: "user",
          content: [
            {
              type: "text",
              text: `${baseText}\n\nThe image(s) below ARE what the user just sent (a photo and/or the frames of a single GIF) — base your reaction on what is actually shown in them, not just the text.`,
            },
            ...imageUrls.map((url) => ({
              type: "image_url" as const,
              image_url: { url, detail: "low" as const },
            })),
          ],
        }
      : { role: "user", content: baseText };

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: args.systemPrompt },
  ];
  const memory = args.memoryBlock?.trim();
  if (memory) messages.push({ role: "system", content: memory });
  messages.push(userMessage);
  return messages;
}

// Runs the nano media decider: given the assembled decider system prompt plus a
// compact history and the latest user message, returns whether to attach a
// reaction GIF/meme and the search term. Never throws — any failure (API error,
// bad JSON) resolves to "none" so the turn still produces a normal reply. Always
// reports usage so the orchestrator can bill the nano call alongside the reply.
export async function decideMedia(args: {
  apiKey: string;
  systemPrompt: string;
  // Per-user taste memory (paid-gated, decider-framed). See buildDeciderMessages.
  memoryBlock?: string;
  history: string;
  currentMessage: string;
  // Reaction titles already sent recently (from buildDeciderContext). Surfaced
  // as an explicit "do not repeat" list so nano varies its picks.
  recentReactions?: string[];
  // Model-ready image URLs for the CURRENT user turn — uploaded image(s) and/or
  // decoded GIF frames. When present they're attached to the decider's user
  // message (at detail:"low") so it reacts to what the user ACTUALLY sent
  // instead of a blind "[user sent a GIF]" placeholder — which is what made it
  // pick out-of-context reactions on media turns.
  imageUrls?: string[];
  signal?: AbortSignal;
}): Promise<{ decision: MediaDecision; usage: ModelUsage }> {
  try {
    const client = new OpenAI({ apiKey: args.apiKey });
    const completion = await client.chat.completions.create(
      {
        model: resolveModelId("nano"),
        // Reasoning model: max_completion_tokens covers reasoning + the tiny JSON
        // verdict. Low effort + real headroom (matching the title model) so the
        // reasoning pass can't starve the decision into an empty/length finish.
        reasoning_effort: "low",
        max_completion_tokens: 1000,
        response_format: RESPONSE_FORMAT,
        messages: buildDeciderMessages({
          systemPrompt: args.systemPrompt,
          memoryBlock: args.memoryBlock,
          history: args.history,
          currentMessage: args.currentMessage,
          recentReactions: args.recentReactions,
          imageUrls: args.imageUrls,
        }),
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
