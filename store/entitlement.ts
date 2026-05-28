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

// The Firestore-backed entitlement mirror can lag behind the live RC state
// (e.g. user just purchased, syncRevenueCatPlan / webhook haven't completed
// the round-trip yet). For UI purposes we always take the highest-rank
// known tier between the server mirror and the local RC store so the user
// sees their new plan instantly after a successful purchase.
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
