import { Timestamp } from "firebase-admin/firestore";
import { PLANS, computeDailyCap } from "../../billing/plans";
import {
  DAILY_WINDOW_MS,
  MONTHLY_WINDOW_MS,
  type ProfileBilling,
} from "../../entitlement/schema";
import { handleRcEvent, isSandboxEvent } from "../handle";
import type { RcEvent } from "../types";

const T0 = 1_700_000_000_000;
const NOW = new Date(T0);

function billing(overrides: Partial<ProfileBilling> = {}): ProfileBilling {
  return {
    plan: "free",
    planSource: "stub",
    rcAppUserId: null,
    rcActiveProductId: null,
    rcEntitlementExpiresAt: null,
    monthlyCredits: PLANS.free.monthlyCredits,
    softDailyCredits: computeDailyCap(PLANS.free.monthlyCredits, NOW),
    creditsRemaining: PLANS.free.monthlyCredits,
    creditsResetAt: Timestamp.fromMillis(T0 + MONTHLY_WINDOW_MS),
    dailyCreditsUsed: 0,
    dailyResetAt: Timestamp.fromMillis(T0 + DAILY_WINDOW_MS),
    ...overrides,
  };
}

describe("handleRcEvent", () => {
  it("INITIAL_PURCHASE of monthly grants basic with full credit budget", () => {
    const event: RcEvent = {
      id: "evt-1",
      type: "INITIAL_PURCHASE",
      app_user_id: "uid-1",
      product_id: "monthly",
      expiration_at_ms: T0 + MONTHLY_WINDOW_MS,
    };
    const d = handleRcEvent(billing(), event, NOW);
    expect(d.kind).toBe("apply");
    if (d.kind === "apply") {
      expect(d.next.plan).toBe("basic");
      expect(d.next.planSource).toBe("revenuecat");
      expect(d.next.creditsRemaining).toBe(PLANS.basic.monthlyCredits);
      expect(d.next.dailyCreditsUsed).toBe(0);
    }
  });

  it("PRODUCT_CHANGE from monthly to monthly_3 grants power's full budget immediately", () => {
    const event: RcEvent = {
      id: "evt-2",
      type: "PRODUCT_CHANGE",
      app_user_id: "uid-1",
      product_id: "monthly",
      new_product_id: "monthly_3",
    };
    const d = handleRcEvent(
      billing({ plan: "basic", creditsRemaining: 50 }),
      event,
      NOW,
    );
    expect(d.kind).toBe("apply");
    if (d.kind === "apply") {
      expect(d.next.plan).toBe("power");
      expect(d.next.creditsRemaining).toBe(PLANS.power.monthlyCredits);
      // The daily cap must rise with the upgrade — this is the core bug fix.
      expect(d.next.monthlyCredits).toBe(PLANS.power.monthlyCredits);
      expect(d.next.softDailyCredits).toBe(
        computeDailyCap(PLANS.power.monthlyCredits, NOW),
      );
      // ...and it must be strictly higher than the basic tier it replaced.
      expect(d.next.monthlyCredits!).toBeGreaterThan(PLANS.basic.monthlyCredits);
      expect(d.next.softDailyCredits!).toBeGreaterThan(
        computeDailyCap(PLANS.basic.monthlyCredits, NOW),
      );
    }
  });

  it("RENEWAL refreshes the credit budget at the same tier", () => {
    const event: RcEvent = {
      id: "evt-3",
      type: "RENEWAL",
      app_user_id: "uid-1",
      product_id: "monthly_2",
    };
    const d = handleRcEvent(billing({ plan: "plus", creditsRemaining: 1 }), event, NOW);
    expect(d.kind).toBe("apply");
    if (d.kind === "apply") {
      expect(d.next.plan).toBe("plus");
      expect(d.next.creditsRemaining).toBe(PLANS.plus.monthlyCredits);
    }
  });

  it("EXPIRATION drops to free but leaves creditsRemaining untouched", () => {
    const event: RcEvent = {
      id: "evt-4",
      type: "EXPIRATION",
      app_user_id: "uid-1",
    };
    const d = handleRcEvent(
      billing({ plan: "plus", creditsRemaining: 2345 }),
      event,
      NOW,
    );
    expect(d.kind).toBe("apply");
    if (d.kind === "apply") {
      expect(d.next.plan).toBe("free");
      expect(d.next.creditsRemaining).toBeUndefined(); // not touched
    }
  });

  it("CANCELLATION drops to free", () => {
    const event: RcEvent = {
      id: "evt-5",
      type: "CANCELLATION",
      app_user_id: "uid-1",
    };
    const d = handleRcEvent(billing({ plan: "power" }), event, NOW);
    expect(d.kind).toBe("apply");
    if (d.kind === "apply") {
      expect(d.next.plan).toBe("free");
      expect(d.next.creditsRemaining).toBeUndefined();
    }
  });

  it("BILLING_ISSUE is a skip (RC grace period handles it)", () => {
    const event: RcEvent = {
      id: "evt-6",
      type: "BILLING_ISSUE",
      app_user_id: "uid-1",
    };
    const d = handleRcEvent(billing({ plan: "plus" }), event, NOW);
    expect(d.kind).toBe("skip");
  });

  it("unknown product_id is a skip", () => {
    const event: RcEvent = {
      id: "evt-7",
      type: "INITIAL_PURCHASE",
      app_user_id: "uid-1",
      product_id: "yearly_legacy",
    };
    const d = handleRcEvent(billing(), event, NOW);
    expect(d.kind).toBe("skip");
  });

  it("TEST events skip", () => {
    const event: RcEvent = {
      id: "evt-8",
      type: "TEST",
      app_user_id: "uid-1",
    };
    expect(handleRcEvent(null, event, NOW).kind).toBe("skip");
  });
});

describe("isSandboxEvent", () => {
  it("flags SANDBOX environment", () => {
    expect(
      isSandboxEvent({
        id: "x",
        type: "RENEWAL",
        app_user_id: "u",
        environment: "SANDBOX",
      }),
    ).toBe(true);
  });

  it("does not flag PRODUCTION or missing environment", () => {
    expect(
      isSandboxEvent({
        id: "x",
        type: "RENEWAL",
        app_user_id: "u",
        environment: "PRODUCTION",
      }),
    ).toBe(false);
    expect(isSandboxEvent({ id: "x", type: "RENEWAL", app_user_id: "u" })).toBe(false);
  });
});
