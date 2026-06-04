// Pure RevenueCat CustomerInfo → app plan resolver. Factored out of
// store/subscription.ts so it can be unit-tested under ts-jest/node (it imports
// react-native-purchases for TYPES only, which are erased at runtime — no
// native module is pulled in).
import type {
  CustomerInfo,
  PurchasesEntitlementInfo,
} from "react-native-purchases";
import {
  REVENUECAT_PRODUCT_TO_PLAN,
  isKnownRcProduct,
  resolvePlanFromRcProductIds,
  type PlanId,
} from "@/domain/billing";

export type DerivedRc = {
  plan: PlanId;
  activeProductId: string | null;
  expiresAt: Date | null;
  hasActiveEntitlement: boolean;
  managementUrl: string | null;
};

const FREE_DERIVED: DerivedRc = {
  plan: "free",
  activeProductId: null,
  expiresAt: null,
  hasActiveEntitlement: false,
  managementUrl: null,
};

// Picks the highest-rank active product identifier, then resolves to a plan via
// the shared mapping. Pre-RC-purchase / unentitled users land on "free".
//
// Resilience note: we resolve the plan from the UNION of two sources —
//   1. the product ids backing each ACTIVE entitlement (the "correct" path), and
//   2. info.activeSubscriptions (the raw active subscription skus).
// RevenueCat populates activeSubscriptions for any active store subscription
// EVEN WHEN that product isn't attached to an entitlement in the dashboard. If
// we trusted entitlements.active alone, a single misconfigured/unattached
// product would leave it empty and every paying user would be wrongly treated as
// free — and Restore Purchases would report "no active sub" despite a valid,
// active subscription. Reading activeSubscriptions too makes the app correct
// regardless of the entitlement-attachment config.
export function deriveFromCustomerInfo(
  info: CustomerInfo | null | undefined,
  entitlementId: string,
): DerivedRc {
  if (!info) return FREE_DERIVED;

  const active = info.entitlements?.active ?? {};
  const entitlements: PurchasesEntitlementInfo[] = Object.values(active);

  const entitlementProductIds = entitlements
    .map((e) => e.productIdentifier)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const subscriptionProductIds = (info.activeSubscriptions ?? []).filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );

  const candidateProductIds = [...entitlementProductIds, ...subscriptionProductIds];

  const plan = resolvePlanFromRcProductIds(candidateProductIds);
  const dominantProductId =
    candidateProductIds.find(
      (id) => isKnownRcProduct(id) && REVENUECAT_PRODUCT_TO_PLAN[id] === plan,
    ) ?? null;

  // Expiry, best-effort for display: prefer the matching entitlement's
  // expirationDate; if the product is unattached (no entitlement) fall back to
  // the per-product subscription info, which RC populates either way.
  const dominantEntitlement =
    dominantProductId !== null
      ? entitlements.find((e) => e.productIdentifier === dominantProductId)
      : entitlements[0];

  let expiresAt: Date | null = dominantEntitlement?.expirationDate
    ? new Date(dominantEntitlement.expirationDate)
    : null;
  if (!expiresAt && dominantProductId) {
    const iso =
      info.subscriptionsByProductIdentifier?.[dominantProductId]?.expiresDate ??
      info.allExpirationDates?.[dominantProductId] ??
      null;
    if (iso) expiresAt = new Date(iso);
  }

  // Active if any known product resolved a paid plan (covers the unattached
  // case) OR the configured entitlement is explicitly active.
  const hasActiveEntitlement =
    plan !== "free" || Boolean(active[entitlementId]?.isActive);

  return {
    plan,
    activeProductId: dominantProductId,
    expiresAt,
    hasActiveEntitlement,
    managementUrl: info.managementURL ?? null,
  };
}
