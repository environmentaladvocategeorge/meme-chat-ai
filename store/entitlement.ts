import { PLAN_RANK, type PlanId } from "@/domain/billing";
import {
  subscribeToEntitlement,
  type Entitlement,
} from "@/services/firebase/entitlement";
import { useSubscriptionStore } from "@/store/subscription";
import { useMemo } from "react";
import { create } from "zustand";

type EntitlementState = {
  entitlement: Entitlement | null;
  uid: string | null;
  bindUid: (uid: string | null) => void;
};

// Display plan — the single source of truth for everything the user SEES
// (plan label, caps, limits, gating). Reads ONLY the backend entitlement
// mirror, so the plan label can never disagree with the usage bars (which are
// mirror-derived too). After a purchase the mirror is refreshed by
// syncRevenueCatPlan + the RC webhook, and the Firestore listener pushes it
// here within a beat.
export function useDisplayPlan(): PlanId {
  return useEntitlementStore((s) => s.entitlement?.plan ?? "free");
}

// Effective plan — the higher-rank tier between the RC-live state and the
// backend mirror. Reserved for PAYMENT-CRITICAL routing only (purchase vs.
// manage-in-store), where RC is the real-time truth of "do you have an active
// subscription right now" and must win immediately to avoid double charges.
// Do NOT use this to display limits/allowance.
export function useEffectivePlan(): PlanId {
  const entitlementPlan = useEntitlementStore((s) => s.entitlement?.plan ?? "free");
  const subscriptionPlan = useSubscriptionStore((s) => s.plan);
  return useMemo(() => {
    return PLAN_RANK[subscriptionPlan] > PLAN_RANK[entitlementPlan]
      ? subscriptionPlan
      : entitlementPlan;
  }, [entitlementPlan, subscriptionPlan]);
}

let unsubscribe: (() => void) | null = null;

export const useEntitlementStore = create<EntitlementState>()((set, get) => ({
  entitlement: null,
  uid: null,

  bindUid: (uid) => {
    if (get().uid === uid) return;

    unsubscribe?.();
    unsubscribe = null;

    set({ uid, entitlement: null });

    if (uid) {
      unsubscribe = subscribeToEntitlement(uid, (entitlement) => {
        set({ entitlement });
      });
    }
  },
}));
