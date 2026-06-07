import { Timestamp } from "firebase-admin/firestore";
import { PLANS, computeDailyCap } from "../../billing/plans";
import { computeResets } from "../reset";
import {
  DAILY_WINDOW_MS,
  MONTHLY_WINDOW_MS,
  type ProfileBilling,
} from "../schema";

const T0 = 1_700_000_000_000; // arbitrary fixed instant for deterministic tests

function makeBilling(overrides: Partial<ProfileBilling> = {}): ProfileBilling {
  return {
    plan: "basic",
    planSource: "revenuecat",
    rcAppUserId: "uid-1",
    rcActiveProductId: "monthly",
    rcEntitlementExpiresAt: null,
    rcIsInTrial: false,
    rcTrialExpiresAt: null,
    monthlyCredits: PLANS.basic.monthlyCredits,
    softDailyCredits: computeDailyCap(PLANS.basic.monthlyCredits, new Date(T0)),
    creditsRemaining: 5,
    creditsResetAt: Timestamp.fromMillis(T0 + MONTHLY_WINDOW_MS),
    dailyCreditsUsed: 7,
    dailyResetAt: Timestamp.fromMillis(T0 + DAILY_WINDOW_MS),
    ...overrides,
  };
}

describe("computeResets", () => {
  it("no resets when both windows are in the future", () => {
    const { monthlyReset, dailyReset, next } = computeResets(makeBilling(), T0);
    expect(monthlyReset).toBe(false);
    expect(dailyReset).toBe(false);
    expect(next.creditsRemaining).toBe(5);
    expect(next.dailyCreditsUsed).toBe(7);
  });

  it("monthly reset refills credits to plan.monthlyCredits", () => {
    const state = makeBilling({
      plan: "plus",
      creditsRemaining: 3,
      creditsResetAt: Timestamp.fromMillis(T0 - 1),
    });
    const { monthlyReset, next } = computeResets(state, T0);
    expect(monthlyReset).toBe(true);
    expect(next.creditsRemaining).toBe(PLANS.plus.monthlyCredits);
  });

  it("monthly reset advances the anchor in window-sized hops (no stacking for dormant users)", () => {
    const dormantSince = T0 - 95 * 24 * 60 * 60 * 1000; // ~3 months ago
    const state = makeBilling({
      creditsResetAt: Timestamp.fromMillis(dormantSince),
    });
    const { next } = computeResets(state, T0);
    // creditsRemaining is just the plan budget, not 3x it.
    expect(next.creditsRemaining).toBe(PLANS.basic.monthlyCredits);
    // new anchor is strictly in the future.
    expect(next.creditsResetAt.toMillis()).toBeGreaterThan(T0);
  });

  it("daily reset zeros dailyCreditsUsed, advances anchor, and refreshes the cap", () => {
    const state = makeBilling({
      dailyCreditsUsed: 88,
      dailyResetAt: Timestamp.fromMillis(T0 - 1),
    });
    const { dailyReset, next } = computeResets(state, T0);
    expect(dailyReset).toBe(true);
    expect(next.dailyCreditsUsed).toBe(0);
    expect(next.dailyResetAt.toMillis()).toBeGreaterThan(T0);
    expect(next.softDailyCredits).toBe(
      computeDailyCap(PLANS.basic.monthlyCredits, new Date(T0)),
    );
  });

  it("both windows can reset in a single pass", () => {
    const state = makeBilling({
      creditsResetAt: Timestamp.fromMillis(T0 - 1),
      dailyResetAt: Timestamp.fromMillis(T0 - 1),
    });
    const { monthlyReset, dailyReset, next } = computeResets(state, T0);
    expect(monthlyReset).toBe(true);
    expect(dailyReset).toBe(true);
    expect(next.creditsRemaining).toBe(PLANS.basic.monthlyCredits);
    expect(next.dailyCreditsUsed).toBe(0);
  });

  it("does not mutate input state", () => {
    const state = makeBilling({
      creditsResetAt: Timestamp.fromMillis(T0 - 1),
    });
    const beforeRemaining = state.creditsRemaining;
    computeResets(state, T0);
    expect(state.creditsRemaining).toBe(beforeRemaining);
  });
});
