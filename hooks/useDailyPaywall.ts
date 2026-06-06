// useDailyPaywall
//
// Surfaces the Plan & Usage paywall once per calendar day for signed-in FREE
// users, the first time the app is opened (cold start / hard refresh) or
// foregrounded that day. Mounted from the (app) layout, so it only ever runs
// once the user is past login + onboarding — it can never fire on the
// logged-out landing/auth screens.
//
// "Once a day" is tracked device-locally by the last-shown calendar date. The
// onboarding flow stamps today's date when it finishes (see
// markDailyPaywallShownToday) so a user who just saw the onboarding paywall
// isn't immediately hit with it again.

import { useEffectivePlan, useEntitlementStore } from "@/store/entitlement";
import { usePlanSheetStore } from "@/store/planSheet";
import { useSubscriptionStore } from "@/store/subscription";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

const LAST_SHOWN_KEY = "app.dailyPaywallShownDate";

// Local calendar day (not UTC) so "once a day" matches the user's wall clock.
function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Stamp today as "paywall already shown". Called by the onboarding flow when it
// completes so the daily gate doesn't double-fire right after the onboarding
// paywall.
export async function markDailyPaywallShownToday(): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_SHOWN_KEY, todayKey());
  } catch {
    // best-effort
  }
}

export function useDailyPaywall(): void {
  const effectivePlan = useEffectivePlan();
  const entitlementLoaded = useEntitlementStore((s) => s.loaded);
  const subscriptionResolved = useSubscriptionStore((s) => s.status !== "idle");
  const openPlan = usePlanSheetStore((s) => s.open);

  // Guards a single in-flight check from racing itself (effect re-runs +
  // AppState change firing together before the date write lands).
  const checking = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const maybeShow = async () => {
      // Only act once we're SURE the user is free: both plan sources resolved
      // and the effective plan is free. During the load window we do nothing
      // rather than flash the paywall at a paying user mid-resolve.
      if (!entitlementLoaded || !subscriptionResolved) return;
      if (effectivePlan !== "free") return;
      if (checking.current) return;

      checking.current = true;
      try {
        const today = todayKey();
        const last = await AsyncStorage.getItem(LAST_SHOWN_KEY).catch(() => null);
        if (cancelled || last === today) return;
        // Stamp before opening so a racing foreground event can't re-open it.
        await AsyncStorage.setItem(LAST_SHOWN_KEY, today).catch(() => {});
        if (!cancelled) openPlan();
      } finally {
        checking.current = false;
      }
    };

    void maybeShow();

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void maybeShow();
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [effectivePlan, entitlementLoaded, subscriptionResolved, openPlan]);
}
