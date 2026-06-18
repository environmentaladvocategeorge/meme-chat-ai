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

// ── Image generation (persona avatars) ───────────────────────────────────────
// Persona avatars are generated with gpt-image-1-mini at the cheapest tier that
// still reads well in a circular avatar (rendered 96px max): a square 1024×1024
// at `low` quality. The cost is billed against the user's normal credit ledger
// (one usageEvent of kind "avatar" per generated image — see ledger.ts), so it
// shares the same daily/monthly allowance as chat.
export const AVATAR_IMAGE_MODEL = "gpt-image-1-mini";
export const AVATAR_IMAGE_SIZE = "1024x1024" as const;
export const AVATAR_IMAGE_QUALITY = "low" as const;

// USD cost of ONE generated avatar image at the size/quality above. This must
// track OpenAI's published per-image price for gpt-image-1-mini `low` 1024² —
// like MODEL_PRICING, if it drifts the credit charge lies. The tiny text-prompt
// input cost (~100 chars) is absorbed; the per-image output price dominates.
// At USD_PER_CREDIT ($0.001) this is ~5 credits/image → ~10 per two-image batch.
export const AVATAR_IMAGE_USD = 0.005;
