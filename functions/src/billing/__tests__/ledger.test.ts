import { Timestamp } from "firebase-admin/firestore";
import { PLANS } from "../plans";
import {
  evaluateRelease,
  evaluateReserve,
  evaluateSettle,
  type ReservationDoc,
} from "../ledger";
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

describe("evaluateReserve", () => {
  it("rejects when daily cap would be exceeded", () => {
    const r = evaluateReserve({
      state: billing({ dailyCreditsUsed: PLANS.plus.softDailyCredits }),
      plan: "plus",
      reservedCredits: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("daily");
  });

  it("rejects when monthly credits insufficient", () => {
    const r = evaluateReserve({
      state: billing({ creditsRemaining: 2 }),
      plan: "plus",
      reservedCredits: 5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("monthly");
  });

  it("approves and decrements credits + dailyUsed", () => {
    const start = billing({ creditsRemaining: 100, dailyCreditsUsed: 5 });
    const r = evaluateReserve({
      state: start,
      plan: "plus",
      reservedCredits: 10,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next.creditsRemaining).toBe(90);
      expect(r.next.dailyCreditsUsed).toBe(15);
    }
  });

  it("free user can spend credits", () => {
    const r = evaluateReserve({
      state: billing({ plan: "free", creditsRemaining: 50 }),
      plan: "free",
      reservedCredits: 3,
    });
    expect(r.ok).toBe(true);
  });
});

describe("evaluateSettle", () => {
  function reservation(overrides: Partial<ReservationDoc> = {}): ReservationDoc {
    return {
      model: "nano",
      reservedCredits: 10,
      state: "open",
      createdAt: Timestamp.fromMillis(T0),
      ...overrides,
    };
  }

  it("refunds when actual < reserved", () => {
    const state = billing({
      creditsRemaining: PLANS.plus.monthlyCredits - 10,
      dailyCreditsUsed: 10,
    });
    const next = evaluateSettle({
      state,
      reservation: reservation({ reservedCredits: 10 }),
      actualCredits: 3,
    });
    expect(next.creditsRemaining).toBe(PLANS.plus.monthlyCredits - 3);
    expect(next.dailyCreditsUsed).toBe(3);
  });

  it("charges additional credits when actual > reserved", () => {
    const state = billing({
      creditsRemaining: PLANS.plus.monthlyCredits - 10,
      dailyCreditsUsed: 10,
    });
    const next = evaluateSettle({
      state,
      reservation: reservation({ reservedCredits: 10 }),
      actualCredits: 15,
    });
    expect(next.creditsRemaining).toBe(PLANS.plus.monthlyCredits - 15);
    expect(next.dailyCreditsUsed).toBe(15);
  });

  it("clamps creditsRemaining at 0 instead of going negative", () => {
    const state = billing({ creditsRemaining: 0 });
    const next = evaluateSettle({
      state,
      reservation: reservation({ reservedCredits: 10 }),
      actualCredits: 50,
    });
    expect(next.creditsRemaining).toBe(0);
  });
});

describe("evaluateRelease", () => {
  it("fully refunds the reserved credits", () => {
    const state = billing({
      creditsRemaining: PLANS.plus.monthlyCredits - 25,
      dailyCreditsUsed: 25,
    });
    const next = evaluateRelease(state, {
      model: "mini",
      reservedCredits: 25,
      state: "open",
      createdAt: Timestamp.fromMillis(T0),
    });
    expect(next.creditsRemaining).toBe(PLANS.plus.monthlyCredits);
    expect(next.dailyCreditsUsed).toBe(0);
  });
});

describe("sequential reserve/settle simulation", () => {
  // Property-style test: starting from a known state, run a sequence of
  // reserve→settle pairs through the pure logic. Final creditsRemaining must
  // equal initial minus sum of actualCredits, never less than 0.
  it("totals reconcile across many cycles", () => {
    // Cumulative daily usage stays under plus.softDailyCredits so no cycle is
    // rejected by the daily cap — this test exercises credit reconciliation,
    // not the cap itself.
    let state = billing({ creditsRemaining: 1000, dailyCreditsUsed: 0 });
    const cycles = [
      { reserved: 50, actual: 47 },
      { reserved: 30, actual: 30 },
      { reserved: 10, actual: 5 },
      { reserved: 40, actual: 42 },
      { reserved: 20, actual: 0 },
    ];

    let totalActual = 0;
    for (const c of cycles) {
      const reserveResult = evaluateReserve({
        state,
        plan: "plus",
        reservedCredits: c.reserved,
      });
      expect(reserveResult.ok).toBe(true);
      if (!reserveResult.ok) return;
      state = reserveResult.next;

      state = evaluateSettle({
        state,
        reservation: {
          model: "nano",
          reservedCredits: c.reserved,
          state: "open",
          createdAt: Timestamp.fromMillis(T0),
        },
        actualCredits: c.actual,
      });
      totalActual += c.actual;
    }

    expect(state.creditsRemaining).toBe(1000 - totalActual);
    expect(state.dailyCreditsUsed).toBe(totalActual);
  });
});
