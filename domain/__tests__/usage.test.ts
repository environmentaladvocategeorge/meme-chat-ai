import {
  computeUsageState,
  formatResetMoment,
  isWithinCountdownWindow,
  NEAR_LIMIT_RATIO,
  type UsageInput,
} from "@/domain/usage";

const HOUR_MS = 60 * 60 * 1000;

// Baseline: plenty of headroom on both windows. Individual tests override only
// the fields they care about.
function input(overrides: Partial<UsageInput> = {}): UsageInput {
  return {
    plan: "free",
    creditsRemaining: 200,
    monthlyCredits: 200,
    dailyCreditsUsed: 0,
    softDailyCredits: 20,
    creditsResetAt: new Date("2026-07-01T00:00:00Z"),
    dailyResetAt: new Date("2026-05-30T00:00:00Z"),
    ...overrides,
  };
}

describe("computeUsageState", () => {
  it("reports the daily window as binding when it has the least headroom", () => {
    const state = computeUsageState(
      input({
        monthlyCredits: 200,
        creditsRemaining: 190, // 5% monthly used
        softDailyCredits: 20,
        dailyCreditsUsed: 18, // 90% daily used
      }),
    );

    expect(state.limitKind).toBe("daily");
    expect(state.dailyRatioUsed).toBeCloseTo(0.9);
    expect(state.monthlyRatioUsed).toBeCloseTo(0.05);
    expect(state.bindingPercentLeft).toBe(10);
    expect(state.monthlyPercentLeft).toBe(95);
    expect(state.bindingResetAt).toEqual(input().dailyResetAt);
    expect(state.nearLimit).toBe(true);
    expect(state.atLimit).toBe(false);
  });

  it("reports the monthly window as binding when no daily cap applies", () => {
    const state = computeUsageState(
      input({
        monthlyCredits: 1000,
        creditsRemaining: 50, // 95% monthly used
        softDailyCredits: 0, // no daily cap
        dailyCreditsUsed: 0,
      }),
    );

    expect(state.limitKind).toBe("monthly");
    expect(state.dailyRatioUsed).toBe(0);
    expect(state.monthlyRatioUsed).toBeCloseTo(0.95);
    // 95% used → "6% left", not 5%: displayPercentLeft rounds UP (and float
    // imprecision on 1 - 0.95 nudges ceil to 6). The round-up is deliberate —
    // it over-states remaining so a user never sees a scary 0% prematurely.
    expect(state.bindingPercentLeft).toBe(6);
    expect(state.bindingResetAt).toEqual(input().creditsResetAt);
    expect(state.nearLimit).toBe(true);
    expect(state.atLimit).toBe(false);
  });

  it("flags atLimit once the binding allowance is fully spent (monthly)", () => {
    const state = computeUsageState(
      input({ monthlyCredits: 100, creditsRemaining: 0, softDailyCredits: 0 }),
    );

    expect(state.limitKind).toBe("monthly");
    expect(state.atLimit).toBe(true);
    expect(state.nearLimit).toBe(true);
    expect(state.bindingPercentLeft).toBe(0);
  });

  it("flags atLimit when the daily cap is exhausted", () => {
    const state = computeUsageState(
      input({ softDailyCredits: 20, dailyCreditsUsed: 20 }),
    );

    expect(state.limitKind).toBe("daily");
    expect(state.atLimit).toBe(true);
    expect(state.bindingPercentLeft).toBe(0);
  });

  it("never shows 0% left while a sliver of credit remains (rounds up)", () => {
    const state = computeUsageState(
      input({ monthlyCredits: 1000, creditsRemaining: 4, softDailyCredits: 0 }),
    );

    // 99.6% used — still has credit, so must read 1% not 0%, and not atLimit.
    expect(state.monthlyPercentLeft).toBe(1);
    expect(state.bindingPercentLeft).toBe(1);
    expect(state.atLimit).toBe(false);
  });

  it("clamps over-usage so ratios never exceed 1 or go negative", () => {
    const state = computeUsageState(
      input({
        monthlyCredits: 100,
        creditsRemaining: 120, // more remaining than the cap → 0 used, not negative
        softDailyCredits: 20,
        dailyCreditsUsed: 30, // 150% → clamps to 1
      }),
    );

    expect(state.monthlyRatioUsed).toBe(0);
    expect(state.dailyRatioUsed).toBe(1);
    expect(state.atLimit).toBe(true);
  });

  it("treats a zero monthly allowance as 0% used (no divide-by-zero)", () => {
    const state = computeUsageState(
      input({ monthlyCredits: 0, creditsRemaining: 0, softDailyCredits: 0 }),
    );

    expect(state.monthlyRatioUsed).toBe(0);
    expect(state.atLimit).toBe(false);
  });

  it("nearLimit trips exactly at the NEAR_LIMIT_RATIO threshold", () => {
    const justUnder = computeUsageState(
      input({ softDailyCredits: 100, dailyCreditsUsed: 89 }),
    );
    const atThreshold = computeUsageState(
      input({ softDailyCredits: 100, dailyCreditsUsed: 90 }),
    );

    expect(NEAR_LIMIT_RATIO).toBe(0.9);
    expect(justUnder.nearLimit).toBe(false);
    expect(atThreshold.nearLimit).toBe(true);
  });
});

describe("formatResetMoment", () => {
  // Echo the i18n key so we can assert which branch was taken; capture opts via
  // the jest.fn call log.
  const t = jest.fn((key: string) => key);
  beforeEach(() => t.mockClear());

  it("returns 'soon' when there is no reset time", () => {
    expect(formatResetMoment(null, 0, t)).toBe("common.reset.soon");
  });

  it("returns 'soon' when the reset is already in the past", () => {
    expect(formatResetMoment(new Date(-1000), 0, t)).toBe("common.reset.soon");
  });

  it("formats a sub-hour gap as minutes only", () => {
    expect(formatResetMoment(new Date(8 * 60_000), 0, t)).toBe(
      "common.reset.justMinutes",
    );
    expect(t).toHaveBeenCalledWith("common.reset.unitMinutes", { count: 8 });
  });

  it("uses the singular minute unit for exactly one minute", () => {
    formatResetMoment(new Date(60_000), 0, t);
    expect(t).toHaveBeenCalledWith("common.reset.unitMinute", { count: 1 });
  });

  it("formats a whole-hour gap as hours only", () => {
    expect(formatResetMoment(new Date(2 * HOUR_MS), 0, t)).toBe(
      "common.reset.inValue",
    );
    expect(t).toHaveBeenCalledWith("common.reset.unitHours", { count: 2 });
  });

  it("uses the singular hour unit for exactly one hour", () => {
    formatResetMoment(new Date(HOUR_MS), 0, t);
    expect(t).toHaveBeenCalledWith("common.reset.unitHour", { count: 1 });
  });

  it("combines hours and minutes when both are present", () => {
    expect(formatResetMoment(new Date(HOUR_MS + 5 * 60_000), 0, t)).toBe(
      "common.reset.hoursAndMinutes",
    );
  });

  it("falls back to an absolute date once the reset is 6+ hours away", () => {
    expect(formatResetMoment(new Date(6 * HOUR_MS), 0, t)).toBe(
      "common.reset.on",
    );
  });
});

describe("isWithinCountdownWindow", () => {
  it("is false without a reset time", () => {
    expect(isWithinCountdownWindow(null, 0)).toBe(false);
  });

  it("is true inside the 6-hour window", () => {
    expect(isWithinCountdownWindow(new Date(3 * HOUR_MS), 0)).toBe(true);
  });

  it("is false at or beyond 6 hours", () => {
    expect(isWithinCountdownWindow(new Date(6 * HOUR_MS), 0)).toBe(false);
  });

  it("is false for a reset already in the past", () => {
    expect(isWithinCountdownWindow(new Date(-1), 0)).toBe(false);
  });
});
