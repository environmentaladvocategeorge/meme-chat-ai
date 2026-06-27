import {
  computeDailyCap,
  DAILY_BURST_FACTOR,
  daysInMonth,
  PLAN_IDS,
  PLAN_RANK,
  PLANS,
} from "../plans";

describe("plan constants — invariants", () => {
  it("ranks the tiers free < basic < plus < power", () => {
    expect(PLAN_RANK.free).toBeLessThan(PLAN_RANK.basic);
    expect(PLAN_RANK.basic).toBeLessThan(PLAN_RANK.plus);
    expect(PLAN_RANK.plus).toBeLessThan(PLAN_RANK.power);
  });

  it("PLAN_IDS is ordered by ascending rank and every id has a config", () => {
    const byRank = [...PLAN_IDS].sort((a, b) => PLAN_RANK[a] - PLAN_RANK[b]);
    expect(PLAN_IDS).toEqual(byRank);
    for (const id of PLAN_IDS) expect(PLANS[id]).toBeDefined();
  });

  it("monthly credits and token budgets rise monotonically with rank", () => {
    for (let i = 1; i < PLAN_IDS.length; i++) {
      const lo = PLANS[PLAN_IDS[i - 1]];
      const hi = PLANS[PLAN_IDS[i]];
      expect(hi.monthlyCredits).toBeGreaterThan(lo.monthlyCredits);
      expect(hi.maxInputTokens).toBeGreaterThanOrEqual(lo.maxInputTokens);
      expect(hi.maxOutputTokens).toBeGreaterThanOrEqual(lo.maxOutputTokens);
    }
  });

  it("runs the same model on every tier (tone is the product, never a weaker agent)", () => {
    const models = new Set(PLAN_IDS.map((id) => PLANS[id].model));
    expect(models.size).toBe(1);
  });
});

describe("daysInMonth", () => {
  it("knows month lengths including leap February", () => {
    expect(daysInMonth(new Date(2026, 0, 15))).toBe(31); // January
    expect(daysInMonth(new Date(2026, 1, 1))).toBe(28); // Feb 2026 (non-leap)
    expect(daysInMonth(new Date(2024, 1, 1))).toBe(29); // Feb 2024 (leap)
    expect(daysInMonth(new Date(2026, 3, 10))).toBe(30); // April
  });
});

describe("computeDailyCap", () => {
  it("is evenPace * burst factor, rounded", () => {
    const jan = new Date(2026, 0, 1); // 31-day month
    expect(computeDailyCap(310, jan)).toBe(Math.round((310 / 31) * DAILY_BURST_FACTOR));
  });

  it("rises with the monthly budget (so it grows on upgrade)", () => {
    const jan = new Date(2026, 0, 1);
    expect(computeDailyCap(PLANS.power.monthlyCredits, jan)).toBeGreaterThan(
      computeDailyCap(PLANS.free.monthlyCredits, jan),
    );
  });

  it("is larger in a shorter month for the same budget", () => {
    expect(computeDailyCap(280, new Date(2026, 1, 1))).toBeGreaterThan(
      computeDailyCap(280, new Date(2026, 0, 1)),
    );
  });
});
