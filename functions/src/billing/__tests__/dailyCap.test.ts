import { DAILY_BURST_FACTOR, PLANS, computeDailyCap, daysInMonth } from "../plans";

// Use local-time dates (the formula reads getFullYear/getMonth in local time)
// so the expected day counts match regardless of the runner's timezone.
const JAN_2026 = new Date(2026, 0, 15); // 31-day month
const FEB_2026 = new Date(2026, 1, 15); // 28-day month
const APR_2026 = new Date(2026, 3, 15); // 30-day month

describe("daysInMonth", () => {
  it("returns the correct length for 31/30/28-day months", () => {
    expect(daysInMonth(JAN_2026)).toBe(31);
    expect(daysInMonth(APR_2026)).toBe(30);
    expect(daysInMonth(FEB_2026)).toBe(28);
  });
});

describe("computeDailyCap", () => {
  it("is the even daily pace times the burst factor, rounded", () => {
    // plus: 4900/mo over a 31-day month → 4900/31 * 2 = 316.1 → 316
    expect(computeDailyCap(4900, JAN_2026)).toBe(
      Math.round((4900 / 31) * DAILY_BURST_FACTOR),
    );
    expect(computeDailyCap(4900, JAN_2026)).toBe(316);
  });

  it("rises as the plan's monthly budget rises (upgrade increases the cap)", () => {
    const free = computeDailyCap(PLANS.free.monthlyCredits, JAN_2026);
    const basic = computeDailyCap(PLANS.basic.monthlyCredits, JAN_2026);
    const plus = computeDailyCap(PLANS.plus.monthlyCredits, JAN_2026);
    const power = computeDailyCap(PLANS.power.monthlyCredits, JAN_2026);
    expect(free).toBeLessThan(basic);
    expect(basic).toBeLessThan(plus);
    expect(plus).toBeLessThan(power);
  });

  it("gives a shorter month a higher daily cap for the same budget", () => {
    // Fewer days → each day carries more of the budget.
    expect(computeDailyCap(1800, FEB_2026)).toBeGreaterThan(
      computeDailyCap(1800, JAN_2026),
    );
  });

  it("guarantees the budget lasts at least half the month at max daily use", () => {
    for (const date of [JAN_2026, FEB_2026, APR_2026]) {
      for (const { monthlyCredits } of Object.values(PLANS)) {
        const cap = computeDailyCap(monthlyCredits, date);
        const daysToExhaust = monthlyCredits / cap;
        expect(daysToExhaust).toBeGreaterThanOrEqual(daysInMonth(date) / 2 - 1);
      }
    }
  });
});
