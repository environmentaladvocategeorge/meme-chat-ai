import { Timestamp } from "firebase-admin/firestore";
import { PLANS, computeDailyCap } from "../plans";
import { evaluateCharge, evaluateQuota } from "../ledger";
import {
  DAILY_WINDOW_MS,
  MONTHLY_WINDOW_MS,
  type ProfileBilling,
} from "../../entitlement/schema";

const T0 = 1_700_000_000_000;

function billing(overrides: Partial<ProfileBilling> = {}): ProfileBilling {
  return {
    plan: "plus",
    planSource: "revenuecat",
    rcAppUserId: "uid-1",
    rcActiveProductId: "monthly_2",
    rcEntitlementExpiresAt: null,
    monthlyCredits: PLANS.plus.monthlyCredits,
    softDailyCredits: computeDailyCap(PLANS.plus.monthlyCredits, new Date(T0)),
    creditsRemaining: PLANS.plus.monthlyCredits,
    creditsResetAt: Timestamp.fromMillis(T0 + MONTHLY_WINDOW_MS),
    dailyCreditsUsed: 0,
    dailyResetAt: Timestamp.fromMillis(T0 + DAILY_WINDOW_MS),
    ...overrides,
  };
}

describe("evaluateQuota", () => {
  it("allows a turn while both windows have headroom", () => {
    const r = evaluateQuota({
      state: billing({ creditsRemaining: 100, dailyCreditsUsed: 5 }),
      plan: "plus",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects when the daily soft cap is already reached", () => {
    const now = new Date(T0);
    const cap = computeDailyCap(PLANS.plus.monthlyCredits, now);
    const r = evaluateQuota({
      state: billing({ dailyCreditsUsed: cap }),
      plan: "plus",
      now,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("daily");
  });

  it("computes the daily cap from the current plan, so an upgrade lifts it", () => {
    const now = new Date(T0);
    // A usage level that exceeds basic's cap but sits under power's cap must be
    // blocked on basic and allowed once the plan is power — the cap is never a
    // stored constant, it tracks the plan.
    const usage = computeDailyCap(PLANS.basic.monthlyCredits, now) + 1;
    expect(usage).toBeLessThan(computeDailyCap(PLANS.power.monthlyCredits, now));

    const onBasic = evaluateQuota({
      state: billing({ plan: "basic", dailyCreditsUsed: usage }),
      plan: "basic",
      now,
    });
    expect(onBasic.ok).toBe(false);

    const onPower = evaluateQuota({
      state: billing({ plan: "power", dailyCreditsUsed: usage }),
      plan: "power",
      now,
    });
    expect(onPower.ok).toBe(true);
  });

  it("rejects when monthly credits are exhausted", () => {
    const r = evaluateQuota({
      state: billing({ creditsRemaining: 0 }),
      plan: "plus",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("monthly");
  });

  it("does not pre-charge — an allowed turn returns no state mutation", () => {
    // The result carries no `next` state: nothing is held before the stream.
    const r = evaluateQuota({
      state: billing({ creditsRemaining: 100 }),
      plan: "plus",
    });
    expect(r).toEqual({ ok: true });
  });
});

describe("evaluateCharge", () => {
  it("deducts actual credits from remaining and accrues daily used", () => {
    const state = billing({ creditsRemaining: 100, dailyCreditsUsed: 5 });
    const next = evaluateCharge(state, 7);
    expect(next.creditsRemaining).toBe(93);
    expect(next.dailyCreditsUsed).toBe(12);
  });

  it("floors creditsRemaining at 0 rather than going negative", () => {
    const next = evaluateCharge(billing({ creditsRemaining: 3 }), 50);
    expect(next.creditsRemaining).toBe(0);
  });

  it("is a no-op for a zero-credit turn", () => {
    const state = billing({ creditsRemaining: 100, dailyCreditsUsed: 5 });
    const next = evaluateCharge(state, 0);
    expect(next.creditsRemaining).toBe(100);
    expect(next.dailyCreditsUsed).toBe(5);
  });

  it("totals reconcile across many turns (charge-only, no reservation)", () => {
    let state = billing({ creditsRemaining: 1000, dailyCreditsUsed: 0 });
    const actuals = [47, 30, 5, 42, 0];
    let total = 0;
    for (const credits of actuals) {
      state = evaluateCharge(state, credits);
      total += credits;
    }
    expect(state.creditsRemaining).toBe(1000 - total);
    expect(state.dailyCreditsUsed).toBe(total);
  });
});
