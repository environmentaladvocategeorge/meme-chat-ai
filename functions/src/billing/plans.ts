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

// Credits map to AI cost at 1 credit = $0.001 (see credits.ts USD_PER_CREDIT),
// so monthlyCredits is the MAX monthly AI spend per user; unused reservations
// are refunded to real cost on settle. Allocations are sized so worst-case AI
// cost stays well under net subscription revenue even at a 30% app-store fee:
//   Basic $3.99 → ~$2.79 net, $1.20 max cost
//   Plus  $6.99 → ~$4.89 net, $2.00 max cost
//   Power $12.99 → ~$9.09 net, $4.00 max cost
export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    model: "nano",
    monthlyCredits: 200,
    softDailyCredits: 20,
    maxInputTokens: 4000,
    maxOutputTokens: 512,
  },
  basic: {
    model: "nano",
    monthlyCredits: 1200,
    softDailyCredits: 120,
    maxInputTokens: 8000,
    maxOutputTokens: 1024,
  },
  plus: {
    model: "mini",
    monthlyCredits: 2000,
    softDailyCredits: 200,
    maxInputTokens: 16_000,
    maxOutputTokens: 2048,
  },
  power: {
    model: "mini",
    monthlyCredits: 4000,
    softDailyCredits: 400,
    maxInputTokens: 32_000,
    maxOutputTokens: 4096,
  },
};
