import { Timestamp } from "firebase-admin/firestore";
import { PLANS, type PlanId } from "../billing/plans";
import {
  REVENUECAT_PRODUCT_TO_PLAN,
  isKnownRcProduct,
} from "../billing/revenuecat";
import {
  DAILY_WINDOW_MS,
  MONTHLY_WINDOW_MS,
  type ProfileBilling,
} from "../entitlement/schema";
import type { RcEvent } from "./types";

export type HandleDecision =
  // `skip` events are valid but require no state change (BILLING_ISSUE etc.)
  // The caller still writes the idempotency dedup doc so a replay is a no-op.
  | { kind: "skip"; reason: string }
  | { kind: "apply"; next: Partial<ProfileBilling> };

// Pure event → profile-patch transformer. Doesn't touch Firestore. Doesn't
// know about idempotency or sandbox gating — caller handles both before calling.
export function handleRcEvent(
  current: ProfileBilling | null,
  event: RcEvent,
  now: Date,
): HandleDecision {
  switch (event.type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "PRODUCT_CHANGE":
    case "NON_RENEWING_PURCHASE": {
      const productId = event.new_product_id ?? event.product_id;
      if (!productId || !isKnownRcProduct(productId)) {
        return { kind: "skip", reason: "unknown-product" };
      }
      const plan: PlanId = REVENUECAT_PRODUCT_TO_PLAN[productId];
      const planCfg = PLANS[plan];

      // Upgrade-immediate semantics: hand the user the full new monthly
      // budget right now, reset the rolling window anchor, and zero any
      // advanced spend so the new cap is fully available. Per the exec
      // summary, downgrades take effect through RC's natural cycle —
      // PRODUCT_CHANGE fires before the next RENEWAL.
      const next: Partial<ProfileBilling> = {
        plan,
        planSource: "revenuecat",
        rcAppUserId: event.app_user_id,
        rcActiveProductId: productId,
        rcEntitlementExpiresAt:
          typeof event.expiration_at_ms === "number"
            ? Timestamp.fromMillis(event.expiration_at_ms)
            : null,
        creditsRemaining: planCfg.monthlyCredits,
        creditsResetAt: Timestamp.fromMillis(now.getTime() + MONTHLY_WINDOW_MS),
        advancedCreditsUsed: 0,
        dailyCreditsUsed: 0,
        dailyResetAt: Timestamp.fromMillis(now.getTime() + DAILY_WINDOW_MS),
      };
      return { kind: "apply", next };
    }

    case "EXPIRATION":
    case "CANCELLATION": {
      // Drop to free immediately on expiration. Per spec: do NOT zero
      // remaining credits — the user paid for the cycle, let them spend
      // what's left until the next monthly reset.
      const next: Partial<ProfileBilling> = {
        plan: "free",
        planSource: "revenuecat",
        rcActiveProductId: null,
        rcEntitlementExpiresAt: null,
      };
      return { kind: "apply", next };
    }

    case "BILLING_ISSUE":
      // RC handles grace period; we just log. State unchanged.
      return { kind: "skip", reason: "billing-issue-grace" };

    case "SUBSCRIBER_ALIAS":
    case "TRANSFER":
    case "TEST":
      return { kind: "skip", reason: event.type.toLowerCase() };

    default: {
      const unknown: string = event.type;
      void current;
      return { kind: "skip", reason: `unhandled:${unknown}` };
    }
  }
}

export function isSandboxEvent(event: RcEvent): boolean {
  return event.environment === "SANDBOX";
}
