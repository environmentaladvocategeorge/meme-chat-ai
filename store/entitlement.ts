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
  // Becomes true once the first profiles/{uid} snapshot has landed (or there is
  // no signed-in user / no Firebase). Until then `entitlement` is null and the
  // derived plan defaults to "free" — which is indistinguishable from a real
  // free user. Consumers that must NOT act on that default (e.g. the ad gate,
  // which would otherwise flash ads at a paying user mid-load) gate on this.
  loaded: boolean;
  uid: string | null;
  bindUid: (uid: string | null) => void;
  rebind: () => void;
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

// Single gate for whether free-tier ads may render. Ads show ONLY when BOTH
// sources of truth have resolved AND both agree the user is free. This keeps
// the ad gate in lockstep with every other plan-gated surface (which branch on
// the display/effective plan rather than the raw RevenueCat-live `isPro`) and,
// critically, never serves ads during the loading window or to a paying user
// whose paid tier is known to only one source. While anything is still loading
// it returns false, so the banner renders nothing instead of flashing.
export function useAdsAllowed(): boolean {
  const effectivePlan = useEffectivePlan();
  const entitlementLoaded = useEntitlementStore((s) => s.loaded);
  const subscriptionResolved = useSubscriptionStore((s) => s.status !== "idle");
  return entitlementLoaded && subscriptionResolved && effectivePlan === "free";
}

let unsubscribe: (() => void) | null = null;

export const useEntitlementStore = create<EntitlementState>()((set, get) => ({
  entitlement: null,
  loaded: false,
  uid: null,

  bindUid: (uid) => {
    if (get().uid === uid) return;

    unsubscribe?.();
    unsubscribe = null;

    // New identity → back to the loading state. Signing out (uid === null) has
    // nothing to load, so it resolves immediately as "free".
    set({ uid, entitlement: null, loaded: uid === null });

    if (uid) {
      unsubscribe = subscribeToEntitlement(uid, (entitlement) => {
        set({ entitlement, loaded: true });
      });
    }
  },

  // Re-attach the profiles/{uid} listener for the currently-bound uid. The
  // initial listener is attached at sign-in, but a brand-new account's token
  // still carries email_verified=false, so the Firestore rule denies the read
  // and the snapshot dies on permission-denied. onAuthStateChanged does NOT
  // refire on a token refresh, so once the user verifies their email there is
  // nothing to re-establish the (now-permitted) listener — leaving the chat
  // stuck on the loader. refreshEmailVerified calls this after the verified
  // token lands so the snapshot re-attaches and the entitlement finally arrives.
  rebind: () => {
    const { uid } = get();
    if (!uid) return;

    unsubscribe?.();
    unsubscribe = subscribeToEntitlement(uid, (entitlement) => {
      set({ entitlement, loaded: true });
    });
  },
}));
