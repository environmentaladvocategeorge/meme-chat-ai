// Client-side mirror of the small set of billing constants the UI needs.
// Kept in sync with functions/src/billing/{plans,revenuecat,models}.ts by
// convention — if either side changes the RC product mapping or plan ranks,
// update the other.

export type PlanId = "free" | "basic" | "plus" | "power";

export const PLAN_RANK: Record<PlanId, number> = {
  free: 0,
  basic: 1,
  plus: 2,
  power: 3,
};

// Recognizes both store generations so entitlement resolution is correct in
// every build: the original test-store identifiers AND the production App
// Store / Play product IDs. Keys are distinct strings, so including both is
// unambiguous. Keep in sync with functions/src/billing/revenuecat.ts and the
// forward map in components/PlanPaywall.tsx (RC_PRODUCT_BY_MODE).
export const REVENUECAT_PRODUCT_TO_PLAN = {
  // Test store.
  monthly: "basic",
  monthly_2: "plus",
  monthly_3: "power",
  // Production.
  memeaibasic: "basic",
  memeaiplus: "plus",
  memeaipower: "power",
} as const;

export type RevenueCatProductId = keyof typeof REVENUECAT_PRODUCT_TO_PLAN;

export function isKnownRcProduct(id: string): id is RevenueCatProductId {
  return id in REVENUECAT_PRODUCT_TO_PLAN;
}

export function resolvePlanFromRcProductIds(activeProductIds: string[]): PlanId {
  let best: PlanId = "free";
  for (const id of activeProductIds) {
    if (!isKnownRcProduct(id)) continue;
    const candidate = REVENUECAT_PRODUCT_TO_PLAN[id];
    if (PLAN_RANK[candidate] > PLAN_RANK[best]) best = candidate;
  }
  return best;
}
