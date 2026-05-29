import { Timestamp } from "firebase-admin/firestore";
import { PLANS } from "../../billing/plans";
import { initialBilling, readProfileBilling } from "../schema";

describe("initialBilling", () => {
  it("seeds free plan with full monthly credits", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const b = initialBilling(now);
    expect(b.plan).toBe("free");
    expect(b.planSource).toBe("stub");
    expect(b.creditsRemaining).toBe(PLANS.free.monthlyCredits);
    expect(b.dailyCreditsUsed).toBe(0);
    expect(b.rcAppUserId).toBeNull();
    expect(b.rcActiveProductId).toBeNull();
  });

  it("sets monthly reset 30 days out and daily reset 24 hours out", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const b = initialBilling(now);
    const expectedMonthly = now.getTime() + 30 * 24 * 60 * 60 * 1000;
    const expectedDaily = now.getTime() + 24 * 60 * 60 * 1000;
    expect(b.creditsResetAt.toMillis()).toBe(expectedMonthly);
    expect(b.dailyResetAt.toMillis()).toBe(expectedDaily);
  });
});

describe("readProfileBilling", () => {
  it("returns null for legacy profiles missing billing fields", () => {
    expect(readProfileBilling({ uid: "x", email: "a@b.c" })).toBeNull();
    expect(readProfileBilling(null)).toBeNull();
    expect(readProfileBilling(undefined)).toBeNull();
  });

  it("hydrates a complete billing record", () => {
    const now = Date.now();
    const data = {
      plan: "plus",
      planSource: "revenuecat",
      rcAppUserId: "uid-1",
      rcActiveProductId: "monthly_2",
      rcEntitlementExpiresAt: Timestamp.fromMillis(now + 86_400_000),
      creditsRemaining: 4321,
      creditsResetAt: Timestamp.fromMillis(now + 86_400_000),
      dailyCreditsUsed: 50,
      dailyResetAt: Timestamp.fromMillis(now + 3600_000),
    };
    const b = readProfileBilling(data);
    expect(b).not.toBeNull();
    expect(b!.plan).toBe("plus");
    expect(b!.creditsRemaining).toBe(4321);
  });

  it("rejects records with invalid plan", () => {
    const data = {
      plan: "ultra",
      creditsRemaining: 100,
      creditsResetAt: Timestamp.now(),
      dailyResetAt: Timestamp.now(),
    };
    expect(readProfileBilling(data)).toBeNull();
  });
});
