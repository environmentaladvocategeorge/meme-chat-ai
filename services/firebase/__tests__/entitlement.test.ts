jest.mock("firebase/firestore", () => ({
  doc: jest.fn(),
  onSnapshot: jest.fn(),
}));

jest.mock("../app", () => ({
  getFirebaseServices: () => ({ available: false }),
}));

import { mapEntitlement } from "../entitlement";

// Firestore Timestamp stand-in: only `.toDate()` is read by asDate.
const ts = (ms: number) => ({ toDate: () => new Date(ms) });

describe("mapEntitlement", () => {
  it("defaults a missing doc to the free tier with safe fallbacks", () => {
    const e = mapEntitlement(undefined);
    expect(e.plan).toBe("free");
    expect(e.planSource).toBe("unknown");
    expect(e.monthlyCredits).toBeGreaterThan(0);
    // creditsRemaining falls back to the monthly budget when absent.
    expect(e.creditsRemaining).toBe(e.monthlyCredits);
    // softDailyCredits is derived (positive) when the doc omits it.
    expect(e.softDailyCredits).toBeGreaterThan(0);
  });

  it("passes through stored values for a real subscriber doc", () => {
    const e = mapEntitlement({
      plan: "plus",
      planSource: "revenuecat",
      creditsRemaining: 4000,
      monthlyCredits: 5103,
      softDailyCredits: 500,
      dailyCreditsUsed: 120,
      dailyResetAt: ts(Date.now() + 60_000), // window still open
      creditsResetAt: ts(Date.now() + 86_400_000),
    });
    expect(e).toMatchObject({
      plan: "plus",
      planSource: "revenuecat",
      creditsRemaining: 4000,
      monthlyCredits: 5103,
      softDailyCredits: 500,
      dailyCreditsUsed: 120,
    });
    expect(e.dailyResetAt).toBeInstanceOf(Date);
  });

  it("treats an elapsed daily window as reset for display (no phantom limit)", () => {
    const e = mapEntitlement({
      plan: "free",
      monthlyCredits: 370,
      softDailyCredits: 37,
      dailyCreditsUsed: 37, // would read as "at the cap"…
      dailyResetAt: ts(Date.now() - 1000), // …but the window already elapsed
    });
    expect(e.dailyCreditsUsed).toBe(0);
  });

  it("rejects an out-of-enum plan / planSource and falls back", () => {
    const e = mapEntitlement({ plan: "enterprise", planSource: "stripe" });
    expect(e.plan).toBe("free");
    expect(e.planSource).toBe("unknown");
  });

  it("coerces non-number credit fields to fallbacks", () => {
    const e = mapEntitlement({ plan: "basic", monthlyCredits: "lots", creditsRemaining: null });
    expect(typeof e.monthlyCredits).toBe("number");
    expect(e.monthlyCredits).toBeGreaterThan(0);
    expect(e.creditsRemaining).toBe(e.monthlyCredits);
  });
});
