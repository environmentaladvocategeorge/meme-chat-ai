// useDailyPaywall
//
// Surfaces the Plan & Usage paywall for signed-in FREE users on cold start
// (app opened fresh). "Once a day" is tracked device-locally by the last-shown
// calendar date.
//
// The foreground-reopen behaviour (AppState "active") has been removed — the
// paywall now fires at two more targeted moments instead:
//   1. Cold start / hard refresh — handled here on mount.
//   2. First message of the day — handled by useOnSendEffects in the chat screen.
//
// The onboarding flow stamps today's date when it finishes (via
// markDailyPaywallShownToday) so a user who just saw the onboarding paywall
// isn't immediately hit with the daily one.

import { useEffectivePlan, useEntitlementStore } from "@/store/entitlement";
import { usePlanSheetStore } from "@/store/planSheet";
import { useSubscriptionStore } from "@/store/subscription";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef } from "react";

export const LAST_SHOWN_KEY = "app.dailyPaywallShownDate";

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function markDailyPaywallShownToday(): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_SHOWN_KEY, todayKey());
  } catch {
    // best-effort
  }
}

// Module-level mutex so the cold-start hook and the per-send hook can't race
// each other into showing two paywall sheets on the same day.
let inFlight = false;

export async function checkDailyPaywall({
  effectivePlan,
  entitlementLoaded,
  subscriptionResolved,
  openPlan,
}: {
  effectivePlan: string;
  entitlementLoaded: boolean;
  subscriptionResolved: boolean;
  openPlan: () => void;
}): Promise<void> {
  if (!entitlementLoaded || !subscriptionResolved) return;
  if (effectivePlan !== "free") return;
  if (inFlight) return;

  inFlight = true;
  try {
    const today = todayKey();
    const last = await AsyncStorage.getItem(LAST_SHOWN_KEY).catch(() => null);
    if (last === today) return;
    // Stamp before opening so a racing caller short-circuits.
    await AsyncStorage.setItem(LAST_SHOWN_KEY, today).catch(() => {});
    openPlan();
  } finally {
    inFlight = false;
  }
}

export function useDailyPaywall(): void {
  const effectivePlan = useEffectivePlan();
  const entitlementLoaded = useEntitlementStore((s) => s.loaded);
  const subscriptionResolved = useSubscriptionStore((s) => s.status !== "idle");
  const openPlan = usePlanSheetStore((s) => s.open);

  // Guard a concurrent re-run of this specific effect instance.
  const checking = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const maybeShow = async () => {
      if (checking.current) return;
      checking.current = true;
      try {
        if (!cancelled) {
          await checkDailyPaywall({
            effectivePlan,
            entitlementLoaded,
            subscriptionResolved,
            openPlan,
          });
        }
      } finally {
        checking.current = false;
      }
    };

    void maybeShow();

    return () => {
      cancelled = true;
    };
  }, [effectivePlan, entitlementLoaded, subscriptionResolved, openPlan]);
}
