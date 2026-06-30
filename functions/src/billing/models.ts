// ModelId IS the live OpenAI model string. We used to keep short internal
// nicknames (nano/mini) mapped to OpenAI SKUs, but that mapping became a chore
// the moment a new SKU shipped — adding gpt-5.5 meant inventing a nickname and
// wiring it through. Now adding a model is just a new union member + a
// MODEL_PRICING row. The value stored on usageEvents.model and the per-model
// token split fields (`${model}InputTokens`) are therefore the real model name.
//
// gpt-5.4-mini → every chat reply on the standard path (all plans) AND the media
// decider (vision-first since 2026-06-10); gpt-5.4-nano → background memory
// extraction + the look-&-pick / web-search routers; gpt-5.4 (full) → the Big
// Brain reply upgrade (any plan, opt-in per turn — see billing/router.ts).
export type ModelId = "gpt-5.4-nano" | "gpt-5.4-mini" | "gpt-5.4";

export const MODEL_IDS: readonly ModelId[] = [
  "gpt-5.4-nano",
  "gpt-5.4-mini",
  "gpt-5.4",
] as const;

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
//   gpt-5.4:      $2.50 in / $0.25 cached / $15.00 out  (Big Brain upgrade)
// Cached input is OpenAI's standard 10%-of-input rate across the family. The
// gpt-5.4 (full) numbers were verified against published 2026 pricing. Must
// track live OpenAI cost or calculateCostUsd (and therefore credits) lies.
export const MODEL_PRICING: Record<ModelId, ModelPricing> = {
  "gpt-5.4-nano": {
    inputPerToken: 0.2 / 1_000_000,
    cachedInputPerToken: 0.02 / 1_000_000,
    outputPerToken: 1.25 / 1_000_000,
  },
  "gpt-5.4-mini": {
    inputPerToken: 0.75 / 1_000_000,
    cachedInputPerToken: 0.075 / 1_000_000,
    outputPerToken: 4.5 / 1_000_000,
  },
  "gpt-5.4": {
    inputPerToken: 2.5 / 1_000_000,
    cachedInputPerToken: 0.25 / 1_000_000,
    outputPerToken: 15.0 / 1_000_000,
  },
};

// ModelId is already the live OpenAI model string, so this is an identity
// passthrough. Kept (rather than inlined at callsites) so the intent — "turn an
// internal id into the string OpenAI expects" — stays explicit and a future
// indirection (e.g. a region-specific SKU) has one home again.
export function resolveModelId(internalId: ModelId): string {
  return internalId;
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

// ── Web search (Tavily) ──────────────────────────────────────────────────────
// Flat USD cost of ONE Tavily `/search` call at search_depth "basic". Like
// AVATAR_IMAGE_USD this must track Tavily's published per-search price — if it
// drifts the web-search credit charge lies. Billed on top of the turn's token
// cost (the nano router + the extra responder input tokens are token-billed
// separately). At USD_PER_CREDIT ($0.001) this is ~8 credits/search.
export const TAVILY_SEARCH_USD = 0.008;
