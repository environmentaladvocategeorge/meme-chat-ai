import { getEncoding, type Tiktoken } from "js-tiktoken";

// cl100k_base is the encoding used by gpt-4o, gpt-4o-mini, gpt-3.5-turbo.
// Loaded lazily so the cold-start cost lands only on the first request,
// then cached for the lifetime of the function instance.
let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoder) encoder = getEncoding("cl100k_base");
  return encoder;
}

export function countTokens(text: string): number {
  if (!text) return 0;
  return getEncoder().encode(text).length;
}

// Rough per-message overhead OpenAI documents for chat completions:
// 3 tokens per message (role + sentinels) + 3 tokens for assistant prefix
// at the end. Close enough for preflight; the include_usage final chunk
// is the source of truth for billing.
const MESSAGE_OVERHEAD_TOKENS = 3;
const REPLY_OVERHEAD_TOKENS = 3;

// Flat per-image prompt-token cost for a low-detail image input. Probed against
// gpt-5.4-nano and gpt-5.4-mini: each detail:"low" image adds ~250 prompt
// tokens regardless of source dimensions. Kept as a single constant for now;
// promote to a per-model map if a future model diverges.
export const IMAGE_TOKENS_LOW = 250;

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "low" } };

// Estimate tokens for a single message's content. Historical image turns are
// already collapsed to text upstream, so the only image parts we ever see here
// belong to the current turn — each counts as IMAGE_TOKENS_LOW.
function countContentTokens(content: string | ContentPart[]): number {
  if (typeof content === "string") return countTokens(content);
  let total = 0;
  for (const part of content) {
    if (part.type === "text") total += countTokens(part.text);
    else if (part.type === "image_url") total += IMAGE_TOKENS_LOW;
  }
  return total;
}

export function countMessagesTokens(
  messages: Array<{ role: string; content: string | ContentPart[] }>,
): number {
  let total = REPLY_OVERHEAD_TOKENS;
  for (const m of messages) {
    total += MESSAGE_OVERHEAD_TOKENS;
    total += countTokens(m.role);
    total += countContentTokens(m.content);
  }
  return total;
}
