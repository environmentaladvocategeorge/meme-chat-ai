import { PLAN_RANK, type PlanId } from "./plans";

// Maps the live RevenueCat product/package identifiers to internal plan tiers.
// Source of truth on iOS/Android. Webhook handler and client subscription
// store both import this so they can't drift.
export const REVENUECAT_PRODUCT_TO_PLAN = {
  monthly: "basic",
  monthly_2: "plus",
  monthly_3: "power",
} as const;

export type RevenueCatProductId = keyof typeof REVENUECAT_PRODUCT_TO_PLAN;

export function isKnownRcProduct(id: string): id is RevenueCatProductId {
  return id in REVENUECAT_PRODUCT_TO_PLAN;
}

// RC can race during plan changes and report multiple active entitlements
// for an instant. Pick the highest-rank one so the user never gets a worse
// plan than they paid for during the transition.
export function resolvePlanFromRcEntitlements(activeProductIds: string[]): PlanId {
  let best: PlanId = "free";
  for (const id of activeProductIds) {
    if (!isKnownRcProduct(id)) continue;
    const candidate = REVENUECAT_PRODUCT_TO_PLAN[id];
    if (PLAN_RANK[candidate] > PLAN_RANK[best]) best = candidate;
  }
  return best;
}
