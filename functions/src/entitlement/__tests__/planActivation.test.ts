import { computeDailyCap, PLANS, PLAN_IDS, type PlanId } from "../../billing/plans";
import { MONTHLY_WINDOW_MS, DAILY_WINDOW_MS, planActivationFields } from "../schema";

// A fixed instant so the day-of-month math is deterministic. Local-time date
// (computeDailyCap reads local getMonth/getFullYear) → 31-day month.
const NOW = new Date(2026, 0, 15, 12, 0, 0); // Jan 15 2026

// free < basic < plus < power, in rank order.
const ASCENDING: PlanId[] = ["free", "basic", "plus", "power"];

describe("planActivationFields", () => {
  it("hands the activated plan its full monthly budget and matching daily cap", () => {
    for (const plan of PLAN_IDS) {
      const f = planActivationFields(plan, NOW);
      expect(f.monthlyCredits).toBe(PLANS[plan].monthlyCredits);
      expect(f.creditsRemaining).toBe(PLANS[plan].monthlyCredits);
      expect(f.softDailyCredits).toBe(
        computeDailyCap(PLANS[plan].monthlyCredits, NOW),
      );
    }
  });

  it("resets both rolling windows and zeroes the day's usage", () => {
    const f = planActivationFields("plus", NOW);
    expect(f.dailyCreditsUsed).toBe(0);
    expect(f.creditsResetAt.toMillis()).toBe(NOW.getTime() + MONTHLY_WINDOW_MS);
    expect(f.dailyResetAt.toMillis()).toBe(NOW.getTime() + DAILY_WINDOW_MS);
  });

  // The core guarantee behind "upgrading increases the limit": every step up
  // the ladder strictly raises BOTH the monthly budget and the daily cap.
  it("strictly increases monthly credits and daily cap on every upgrade step", () => {
    for (let i = 1; i < ASCENDING.length; i++) {
      const lower = planActivationFields(ASCENDING[i - 1], NOW);
      const higher = planActivationFields(ASCENDING[i], NOW);
      expect(higher.monthlyCredits).toBeGreaterThan(lower.monthlyCredits);
      expect(higher.softDailyCredits).toBeGreaterThan(lower.softDailyCredits);
    }
  });

  it("raises the daily cap for any upgrade, not just adjacent tiers", () => {
    // free → power is the largest jump a user can make.
    const free = planActivationFields("free", NOW);
    const power = planActivationFields("power", NOW);
    expect(power.softDailyCredits).toBeGreaterThan(free.softDailyCredits);
    expect(power.monthlyCredits).toBeGreaterThan(free.monthlyCredits);
  });
});
