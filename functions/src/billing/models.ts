// Stable internal model IDs decouple billing/routing from the live OpenAI
// model string. Swap the OPENAI_MODEL_BY_INTERNAL_ID / MODEL_PRICING entries
// when OpenAI ships new SKUs — no callsite changes.
export type ModelId = "nano" | "mini";

export const MODEL_IDS: readonly ModelId[] = ["nano", "mini"] as const;

// mini → every chat reply (all plans) AND the media decider (vision-first since
// 2026-06-10); nano → background memory extraction only. Resolved to live
// OpenAI models here.
const OPENAI_MODEL_BY_INTERNAL_ID: Record<ModelId, string> = {
  nano: "gpt-5.4-nano",
  mini: "gpt-5.4-mini",
};

// Internal utility model for summaries + conversation titles. NOT user-billed —
// its cost is absorbed as system margin, so it never touches the credit ledger.
export const UTILITY_MODEL = "gpt-5-nano";

export type ModelPricing = {
  // USD per token.
  inputPerToken: number;
  cachedInputPerToken: number;
  outputPerToken: number;
};

// Standard-tier OpenAI pricing (USD per 1M tokens, divided to per-token):
//   gpt-5.4-nano: $0.20 in / $0.02 cached / $1.25 out
//   gpt-5.4-mini: $0.75 in / $0.075 cached / $4.50 out
// Must track live OpenAI cost or calculateCostUsd (and therefore credits) lies.
export const MODEL_PRICING: Record<ModelId, ModelPricing> = {
  nano: {
    inputPerToken: 0.2 / 1_000_000,
    cachedInputPerToken: 0.02 / 1_000_000,
    outputPerToken: 1.25 / 1_000_000,
  },
  mini: {
    inputPerToken: 0.75 / 1_000_000,
    cachedInputPerToken: 0.075 / 1_000_000,
    outputPerToken: 4.5 / 1_000_000,
  },
};

export function resolveModelId(internalId: ModelId): string {
  return OPENAI_MODEL_BY_INTERNAL_ID[internalId];
}
