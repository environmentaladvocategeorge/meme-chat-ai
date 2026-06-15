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
  maxInputTokens: number;
  maxOutputTokens: number;
};

// The daily soft cap is NOT a per-plan constant — it's derived from the plan's
// monthly budget and the length of the current month:
//
//   evenPace   = monthlyCredits / daysInMonth        (the sustainable rate)
//   dailyCap   = round(evenPace * DAILY_BURST_FACTOR)
//
// A burst factor of 3 lets a user spend up to three average days' worth in any
// single day (so a heavy day never feels walled off) while guaranteeing the
// monthly budget still lasts at least ~10 days even if they max the cap out
// every day (≈10% of the monthly budget per day on a 30-day month). It scales
// automatically by plan (via monthlyCredits) and by month length (28–31 days),
// and it rises the moment a user upgrades because monthlyCredits rises.
//
// This is the SINGLE definition of the daily cap. The server computes it and
// writes the resolved number onto profiles/{uid} (softDailyCredits); the client
// only ever reads that stored value — it must never keep its own copy of this
// formula or the plan credit table.
export const DAILY_BURST_FACTOR = 3;

export function daysInMonth(date: Date): number {
  // Day 0 of the next month is the last day of `date`'s month.
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function computeDailyCap(monthlyCredits: number, date: Date): number {
  return Math.round((monthlyCredits / daysInMonth(date)) * DAILY_BURST_FACTOR);
}

// Every user-facing chat tier runs the SAME model (`mini` → gpt-5.4-mini).
// Personality/tone is the product, so we never show a weaker agent — not even
// on free, which is the top of the conversion funnel. Tiers differ only by how
// many credits (= AI budget) they get, not by which model answers.
//
// Credits map to AI cost at 1 credit = $0.001 (see credits.ts USD_PER_CREDIT),
// so monthlyCredits is the MAX monthly AI spend per user. Credits are charged
// once per turn from real token usage (no up-front reservation).
//
// 2026-06-11 re-sizing — the media decider moved gpt-5.4-nano → gpt-5.4-mini
// (vision-first ladder prompt, see personas/mediaDeciderPrompt.ts), which
// raised the measured per-turn cost. From 533 live turns: avg 1.99 credits on
// the nano decider; re-pricing those same decider tokens at mini rates (after
// v4's ~520-token prompt trim) projects ~2.69 credits/turn — decider share
// ~0.41 → ~1.15. Budgets below are sized from that 2.69 figure against
// explicit per-tier margin targets at FULL burn (worst case — typical burn is
// lower, so realized margins run higher). Net revenue assumes the 30%
// app-store fee; credits = net × (1 − target margin) / $0.001:
//   Basic monthly_1  $3.99  → ~$2.79 net, 30% margin → 1953 cr ($1.95 max cost)
//   Plus  monthly_2  $9.99  → ~$6.99 net, 27% margin → 5103 cr ($5.10 max cost)
//   Power monthly_3  $19.99 → ~$13.99 net, 21% margin → 11052 cr ($11.05 max cost)
// Free is the conversion funnel and partly ad-offset: 370 cr ≈ $0.37 max
// cost/user/month ≈ ~138 turns/month, daily cap 37 (30-day month) ≈ ~14
// turns/day. Coverage at 2.69 cr/turn: free ~138, basic ~726, plus ~1,897,
// power ~4,109 messages/month.
// (Plan IDs free/basic/plus/power map to RC products free/monthly_1/monthly_2/
// monthly_3 — see billing/revenuecat.ts.)
//
// History: original 325 / 1950 / 5250 / 11200, trimmed 15% when real usage ran
// under the 2.52-credit estimate; free re-tuned during launch week and raised
// to 205 on 2026-06-10; all tiers re-sized on 2026-06-11 for the mini-decider
// cost (paid tiers to 1953 / 5103 / 11052, their current values); free later
// raised to 370 on 2026-06-14 ($0.37 max cost, ~138 turns/mo) to widen the
// funnel. Re-check against real v4 usage after a few days
// (scripts/analyze-usage.cjs — decider tokens now land in the mini* split
// fields, so the nano* columns are memory-extraction only).
//
// Existing users are migrated in place on every re-size via
// scripts/migrate-plan-credits.cjs (spend-preserving: remaining recomputed as
// new monthly − credits already spent this cycle; softDailyCredits re-derived
// for the current month). PLANS here drives new grants + cycle resets, so a
// functions deploy must accompany any change.
export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    model: "mini",
    monthlyCredits: 370,
    // The static persona/platform prompt is ~4k tokens on its own, so a 4k input
    // budget left free with literally zero room for conversational memory — every
    // turn was persona + current message only. 6k gives ~2k of working headroom
    // (a summary + a handful of verbatim turns), the funnel tier's first real
    // short-term memory. Cost impact is small: the extra tokens are cached on hot
    // turns; only cold returns re-bill them fresh.
    maxInputTokens: 6000,
    maxOutputTokens: 512,
  },
  basic: {
    model: "mini",
    monthlyCredits: 1953,
    maxInputTokens: 8000,
    maxOutputTokens: 1024,
  },
  plus: {
    model: "mini",
    monthlyCredits: 5103,
    maxInputTokens: 16_000,
    maxOutputTokens: 2048,
  },
  power: {
    model: "mini",
    monthlyCredits: 11052,
    maxInputTokens: 32_000,
    maxOutputTokens: 4096,
  },
};
