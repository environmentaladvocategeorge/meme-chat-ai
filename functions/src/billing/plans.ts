import type { ModelId } from "./models";

export type PlanId = "free" | "basic" | "plus" | "power";

export const PLAN_IDS: readonly PlanId[] = ["free", "basic", "plus", "power"] as const;

export const PLAN_RANK: Record<PlanId, number> = {
  free: 0,
  basic: 1,
  plus: 2,
  power: 3,
};

export type PlanConfig = {
  // The single model every request on this plan routes to (no per-request
  // classification or advanced toggle — selection is purely plan-based).
  model: ModelId;
  monthlyCredits: number;
  softDailyCredits: number;
  maxInputTokens: number;
  maxOutputTokens: number;
};

// Every user-facing chat tier runs the SAME model (`mini` → gpt-5.4-mini).
// Personality/tone is the product, so we never show a weaker agent — not even
// on free, which is the top of the conversion funnel. Tiers differ only by how
// many credits (= AI budget) they get, not by which model answers.
//
// Credits map to AI cost at 1 credit = $0.001 (see credits.ts USD_PER_CREDIT),
// so monthlyCredits is the MAX monthly AI spend per user. Credits are charged
// once per turn from real token usage (no up-front reservation). At the average
// message (~3,000 in / ~60 out on mini ≈ $0.00252 ≈ 2.52 credits), the buckets
// below cover roughly: free ~80, basic ~700, plus ~2,000, power ~4,200
// messages/month. Allocations are sized to hold a tiered post-app-store-fee
// margin (30% fee assumed); higher tiers commit more so we accept a thinner
// margin in exchange for far more usage:
//   Basic monthly_1  $3.99  → ~$2.79 net, $1.80 max cost → ~35% margin
//   Plus  monthly_2  $9.99  → ~$6.99 net, $4.90 max cost → ~30% margin
//   Power monthly_3  $19.99 → ~$13.99 net, $10.50 max cost → ~25% margin
// (Plan IDs free/basic/plus/power map to RC products free/monthly_1/monthly_2/
// monthly_3 — see billing/revenuecat.ts.)
export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    model: "mini",
    monthlyCredits: 200,
    softDailyCredits: 20,
    maxInputTokens: 4000,
    maxOutputTokens: 512,
  },
  basic: {
    model: "mini",
    monthlyCredits: 1800,
    softDailyCredits: 180,
    maxInputTokens: 8000,
    maxOutputTokens: 1024,
  },
  plus: {
    model: "mini",
    monthlyCredits: 4900,
    softDailyCredits: 490,
    maxInputTokens: 16_000,
    maxOutputTokens: 2048,
  },
  power: {
    model: "mini",
    monthlyCredits: 10_500,
    softDailyCredits: 1050,
    maxInputTokens: 32_000,
    maxOutputTokens: 4096,
  },
};
