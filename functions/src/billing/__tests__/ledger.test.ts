import { Timestamp } from "firebase-admin/firestore";
import { PLANS } from "../plans";
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
    const r = evaluateQuota({
      state: billing({ dailyCreditsUsed: PLANS.plus.softDailyCredits }),
      plan: "plus",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("daily");
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
