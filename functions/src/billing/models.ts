// Stable internal model IDs decouple billing/routing from the live OpenAI
// model string. When OpenAI ships new SKUs (gpt-5-nano, etc.) swap the
// OPENAI_MODEL_BY_INTERNAL_ID entries and MODEL_PRICING — no callsite changes.
export type ModelId = "nano" | "smart-nano" | "mini" | "smart-mini";

export const MODEL_IDS: readonly ModelId[] = [
  "nano",
  "smart-nano",
  "mini",
  "smart-mini",
] as const;

export const MODEL_RANK: Record<ModelId, number> = {
  nano: 0,
  "smart-nano": 1,
  mini: 2,
  "smart-mini": 3,
};

export type ModelPricing = {
  // USD per token.
  inputPerToken: number;
  cachedInputPerToken: number;
  outputPerToken: number;
};

// Real gpt-4o-mini public pricing (USD per token).
// $0.15/M input, $0.075/M cached input, $0.60/M output.
const GPT_4O_MINI_PRICING: ModelPricing = {
  inputPerToken: 0.15 / 1_000_000,
  cachedInputPerToken: 0.075 / 1_000_000,
  outputPerToken: 0.60 / 1_000_000,
};

// All four internal tiers currently route to gpt-4o-mini. Pricing must match
// the live OpenAI cost or calculateCostUsd will lie. Diverge per-tier the
// moment OPENAI_MODEL_BY_INTERNAL_ID diverges.
export const MODEL_PRICING: Record<ModelId, ModelPricing> = {
  nano: GPT_4O_MINI_PRICING,
  "smart-nano": GPT_4O_MINI_PRICING,
  mini: GPT_4O_MINI_PRICING,
  "smart-mini": GPT_4O_MINI_PRICING,
};

// Multiplier applied to the raw OpenAI cost when converting to internal
// credits. Differentiates plans before underlying models diverge: a smart-mini
// call costs the user 10× the credits of a nano call even when both hit
// gpt-4o-mini.
export const MODEL_CREDIT_MULTIPLIER: Record<ModelId, number> = {
  nano: 1,
  "smart-nano": 2,
  mini: 5,
  "smart-mini": 10,
};

const OPENAI_MODEL_BY_INTERNAL_ID: Record<ModelId, string> = {
  nano: "gpt-4o-mini",
  "smart-nano": "gpt-4o-mini",
  mini: "gpt-4o-mini",
  "smart-mini": "gpt-4o-mini",
};

export function resolveModelId(internalId: ModelId): string {
  return OPENAI_MODEL_BY_INTERNAL_ID[internalId];
}

export function isMiniFamily(id: ModelId): boolean {
  return id === "mini" || id === "smart-mini";
}
