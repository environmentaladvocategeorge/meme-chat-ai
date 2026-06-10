import { logger } from "firebase-functions";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ModelUsage } from "../billing/ledger";
import { resolveModelId } from "../billing/models";
import type { ChatMessage } from "./types";

// Number of distinct greeting-reaction queries in the prompt's greeting row
// (evergreen_reaction_bank fragment, "- greeting:" line). The sync test in
// prompt.lint.test.ts asserts this equals the parsed term count in the fixture —
// change both in the same commit. Value = 14 (from the current live prompt row).
export const GREETING_BANK_SIZE = 14;

// Returns true when the message is a bare opener with no other content: "hi",
// "heyyy", "yo", "wsg", etc. Used by the orchestrator to inject a cold-start
// index so the decider picks a varied greeting reaction instead of always
// defaulting to the same query.
//
// Normalisation steps (in order):
//   1. Trim whitespace from both ends
//   2. Lowercase
//   3. Strip leading AND trailing non-letter/non-digit/non-apostrophe chars
//      (handles "👋 hi", "hi!", "👋 yo 👋", etc.)
//   4. Trim again
//   5. Collapse trailing repeated chars (heyyy→hey, yooo→yo)
//   6. Collapse doubled bare greeting ("hi hi"→"hi", "yo yo"→"yo")
//   7. Match against the canonical opener set
//
// Intentional exclusions: "hello there" is a named Obi-Wan reference and flows
// to rule 1 of the decider, not the cold-start path. Multi-language openers like
// "hola"/"bonjour" are excluded by design — let the decider handle them.
// "gn" (goodnight) is not an opener. "high"/"supreme"/"history" must not match
// their "hi"/"sup" substrings (whole-string match, not substring search).
export function isBareGreeting(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}']+/gu, "") // strip leading punctuation/emoji
    .replace(/[^\p{L}\p{N}']+$/gu, "") // strip trailing punctuation/emoji
    .trim();
  if (!normalized) return false;
  // Collapse trailing repeated characters (heyyy→hey, yooo→yo)
  const dedupedTrailing = normalized.replace(/(.)\1+$/, "$1");
  // Collapse doubled bare greetings ("hi hi"→"hi", "yo yo"→"yo")
  const dedupedDouble = dedupedTrailing.replace(/^(\S+)\s+\1$/, "$1");
  const GREETINGS = new Set([
    "hi",
    "hey",
    "hello",
    "yo",
    "wsg",
    "gm",
    "sup",
    "wassup",
    "what's good",
    "what up",
    "hiya",
    "heyo",
    "ello",
    "ayo",
    "ay",
    "eyy",
    "howdy",
    "henlo",
    "hai",
    "wagwan",
    "oi",
  ]);
  return (
    GREETINGS.has(normalized) ||
    GREETINGS.has(dedupedTrailing) ||
    GREETINGS.has(dedupedDouble)
  );
}

// Pure helper for the orchestrator: decides whether to inject a cold-start index
// into the decider call. Extracted here so it can be unit-tested without mocking
// the full Firebase Cloud Function. The check is `!== undefined` at the call
// site — index 0 is valid.
export function computeColdStartIndex(args: {
  isFirstTurn: boolean;
  hasImages: boolean;
  hasGifs: boolean;
  userText: string;
}): number | undefined {
  if (
    args.isFirstTurn &&
    !args.hasImages &&
    !args.hasGifs &&
    isBareGreeting(args.userText)
  ) {
    return Math.floor(Math.random() * GREETING_BANK_SIZE);
  }
  return undefined;
}

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

// Parses greeting-row terms from an assembled prompt fixture. Supports both
// the explicit-line format ("GREETING_ROW: a | b | c") and the fragment bank
// format ("- greeting: a, b, c"). Returns [] if no row is found.
// Shared by the eval harness (obedience gate) and the prompt lint tests
// (GREETING_BANK_SIZE sync) so neither duplicates the parse logic.
export function parseGreetingRow(promptText: string): string[] {
  const explicitMatch = promptText.match(/^GREETING_ROW:\s*(.+)$/m);
  const bankMatch = promptText.match(/^- greeting:\s*(.+)$/m);
  const match = explicitMatch ?? bankMatch;
  if (!match) return [];
  const sep = explicitMatch ? "|" : ",";
  return match[1]
    .split(sep)
    .map((t) => t.trim())
    .filter(Boolean);
}

// Shared call config for both production decideMedia and the eval harness.
// Exported so the harness can import it from the compiled lib and never drift
// from production on model, effort, token budget, or response schema.
export const DECIDER_CALL_CONFIG = {
  model: resolveModelId("nano"),
  reasoning_effort: "low" as const,
  max_completion_tokens: 1000,
  response_format: RESPONSE_FORMAT,
} as const;

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
  // When defined, appends a binding cold-start tag so the decider picks the Nth
  // greeting-row query instead of choosing freely. MUST use !== undefined check
  // at the call site — index 0 is a valid binding index.
  coldStartIndex?: number;
}): ChatCompletionMessageParam[] {
  const avoid =
    args.recentReactions && args.recentReactions.length > 0
      ? `\n\nReactions ALREADY sent recently — do NOT repeat these or pick anything near-identical, vary it up:\n${args.recentReactions.join(", ")}`
      : "";
  const imageUrls = args.imageUrls ?? [];
  // When a cold-start index is injected, append the binding tag to the message
  // so the decider knows which greeting-row term to pick (see VARIETY block in
  // the live prompt). Index 0 is valid — check !== undefined, not truthiness.
  const coldStartTag =
    args.coldStartIndex !== undefined
      ? `\n\n[cold-start: pick greeting option ${args.coldStartIndex} (0-indexed from greeting row, treat as binding)]`
      : "";
  const baseText =
    (args.history ? `Conversation so far:\n${args.history}\n\n` : "") +
    `Latest user message:\n${args.currentMessage || "[no text — the user sent only an attachment]"}` +
    avoid +
    coldStartTag;

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
  // Cold-start greeting index: when defined, injects a binding tag so the
  // decider picks the Nth term from the greeting row in the prompt instead of
  // choosing freely. Injected only on first-turn bare greetings. Index 0 is
  // valid — callers MUST check !== undefined, not truthiness.
  coldStartIndex?: number;
  signal?: AbortSignal;
}): Promise<{ decision: MediaDecision; usage: ModelUsage }> {
  try {
    const client = new OpenAI({ apiKey: args.apiKey });
    const completion = await client.chat.completions.create(
      {
        ...DECIDER_CALL_CONFIG,
        // Reasoning model: max_completion_tokens covers reasoning + the tiny JSON
        // verdict. Low effort + real headroom (matching the title model) so the
        // reasoning pass can't starve the decision into an empty/length finish.
        messages: buildDeciderMessages({
          systemPrompt: args.systemPrompt,
          memoryBlock: args.memoryBlock,
          history: args.history,
          currentMessage: args.currentMessage,
          recentReactions: args.recentReactions,
          imageUrls: args.imageUrls,
          coldStartIndex: args.coldStartIndex,
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
    const parseFailed = raw.trim().length === 0;
    const decision = parseDecision(raw);

    logger.info("[decideMedia] telemetry", {
      coldStartIndex: args.coldStartIndex ?? null,
      decisionType: decision.type,
      query: decision.type !== "none" ? (decision as { query: string }).query : null,
      parseFailed,
    });

    return { decision, usage };
  } catch (err) {
    logger.warn("[decideMedia] failed; defaulting to no media", { err });
    return { decision: { type: "none" }, usage: ZERO_NANO_USAGE };
  }
}
