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

export function countMessagesTokens(
  messages: Array<{ role: string; content: string }>,
): number {
  let total = REPLY_OVERHEAD_TOKENS;
  for (const m of messages) {
    total += MESSAGE_OVERHEAD_TOKENS;
    total += countTokens(m.role);
    total += countTokens(m.content);
  }
  return total;
}
