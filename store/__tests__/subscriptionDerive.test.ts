import type {
  CustomerInfo,
  PurchasesEntitlementInfo,
} from "react-native-purchases";
import { deriveFromCustomerInfo } from "@/store/subscriptionDerive";

type ActiveMap = Record<string, PurchasesEntitlementInfo>;

// Builds the entitlements container; cast hides RC's enum-typed fields the
// resolver never reads.
function ents(active: ActiveMap): CustomerInfo["entitlements"] {
  return { all: {}, active, verification: "NOT_REQUESTED" } as unknown as
    CustomerInfo["entitlements"];
}

// Minimal CustomerInfo factory — only the fields deriveFromCustomerInfo reads.
function makeInfo(overrides: Partial<CustomerInfo>): CustomerInfo {
  return {
    entitlements: ents({}),
    activeSubscriptions: [],
    allPurchasedProductIdentifiers: [],
    latestExpirationDate: null,
    firstSeen: "2026-01-01T00:00:00Z",
    originalAppUserId: "u1",
    requestDate: "2026-06-04T00:00:00Z",
    allExpirationDates: {},
    allPurchaseDates: {},
    originalApplicationVersion: null,
    originalPurchaseDate: null,
    managementURL: null,
    nonSubscriptionTransactions: [],
    subscriptionsByProductIdentifier: {},
    ...overrides,
  } as CustomerInfo;
}

function activeEntitlement(
  productIdentifier: string,
  expirationDate: string | null,
): PurchasesEntitlementInfo {
  return {
    identifier: "pro",
    isActive: true,
    willRenew: true,
    periodType: "TRIAL",
    latestPurchaseDate: "2026-06-04T00:00:00Z",
    latestPurchaseDateMillis: 0,
    originalPurchaseDate: "2026-06-04T00:00:00Z",
    originalPurchaseDateMillis: 0,
    expirationDate,
    expirationDateMillis: expirationDate ? Date.parse(expirationDate) : null,
    store: "APP_STORE",
    productIdentifier,
    productPlanIdentifier: null,
    isSandbox: false,
    unsubscribeDetectedAt: null,
    unsubscribeDetectedAtMillis: null,
    billingIssueDetectedAt: null,
    billingIssueDetectedAtMillis: null,
    ownershipType: "PURCHASED",
    verification: "NOT_REQUESTED",
  } as unknown as PurchasesEntitlementInfo;
}

describe("deriveFromCustomerInfo", () => {
  it("returns free for null/empty customer info", () => {
    expect(deriveFromCustomerInfo(null, "pro").plan).toBe("free");
    expect(deriveFromCustomerInfo(makeInfo({}), "pro").plan).toBe("free");
  });

  it("resolves the plan from an active entitlement (the configured path)", () => {
    const info = makeInfo({
      entitlements: ents({ pro: activeEntitlement("memeaiplus", "2027-06-04T00:00:00Z") }),
      activeSubscriptions: ["memeaiplus"],
    });
    const d = deriveFromCustomerInfo(info, "pro");
    expect(d.plan).toBe("plus");
    expect(d.activeProductId).toBe("memeaiplus");
    expect(d.hasActiveEntitlement).toBe(true);
    expect(d.expiresAt?.toISOString()).toBe("2027-06-04T00:00:00.000Z");
  });

  // The production bug: a valid, active subscription whose product is NOT
  // attached to any entitlement in the RevenueCat dashboard. entitlements.active
  // is empty, but activeSubscriptions still lists the sku. The user must still
  // resolve to Plus (and Restore must report a sub), not free.
  it("resolves the plan from activeSubscriptions when the product is unattached", () => {
    const info = makeInfo({
      entitlements: ents({}),
      activeSubscriptions: ["memeaiplus"],
      subscriptionsByProductIdentifier: {
        memeaiplus: { expiresDate: "2027-06-04T00:00:00Z" } as never,
      },
    });
    const d = deriveFromCustomerInfo(info, "pro");
    expect(d.plan).toBe("plus");
    expect(d.activeProductId).toBe("memeaiplus");
    expect(d.hasActiveEntitlement).toBe(true);
    expect(d.expiresAt?.toISOString()).toBe("2027-06-04T00:00:00.000Z");
  });

  it("falls back to allExpirationDates for unattached-product expiry", () => {
    const info = makeInfo({
      activeSubscriptions: ["memeaipower"],
      allExpirationDates: { memeaipower: "2027-01-01T00:00:00Z" },
    });
    const d = deriveFromCustomerInfo(info, "pro");
    expect(d.plan).toBe("power");
    expect(d.expiresAt?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("picks the highest-rank plan across mixed sources", () => {
    const info = makeInfo({
      entitlements: ents({ pro: activeEntitlement("memeaibasic", null) }),
      activeSubscriptions: ["memeaibasic", "memeaipower"],
    });
    expect(deriveFromCustomerInfo(info, "pro").plan).toBe("power");
  });

  it("ignores unknown product ids", () => {
    const info = makeInfo({ activeSubscriptions: ["some.other.sku"] });
    const d = deriveFromCustomerInfo(info, "pro");
    expect(d.plan).toBe("free");
    expect(d.hasActiveEntitlement).toBe(false);
  });
});
