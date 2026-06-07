// useOnSendEffects
//
// Fires side-effects once per message send (detected via activeReplyClientId
// transitioning null → value). Two effects piggyback here so we don't need
// multiple store subscriptions:
//   1. Daily paywall check — shows the plan sheet once per calendar day for
//      free users. Acts as a complement to the cold-start check in
//      useDailyPaywall; whichever fires first stamps the day.
//   2. Review prompt counter — increments the lifetime message count and sets
//      the pending flag when the threshold is crossed.

import { checkDailyPaywall } from "@/hooks/useDailyPaywall";
import { useEffectivePlan, useEntitlementStore } from "@/store/entitlement";
import { usePlanSheetStore } from "@/store/planSheet";
import { useReviewPromptStore } from "@/store/reviewPrompt";
import { useSubscriptionStore } from "@/store/subscription";
import { useChatStore } from "@/store/chat";
import { useEffect, useRef } from "react";

export function useOnSendEffects(): void {
  const effectivePlan = useEffectivePlan();
  const entitlementLoaded = useEntitlementStore((s) => s.loaded);
  const subscriptionResolved = useSubscriptionStore((s) => s.status !== "idle");
  const openPlan = usePlanSheetStore((s) => s.open);
  const activeReplyClientId = useChatStore((s) => s.activeReplyClientId);
  const recordMessageSent = useReviewPromptStore((s) => s.recordMessageSent);

  const prevIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Only fire on the null → value transition (new message started).
    if (!activeReplyClientId || activeReplyClientId === prevIdRef.current) return;
    prevIdRef.current = activeReplyClientId;

    void checkDailyPaywall({ effectivePlan, entitlementLoaded, subscriptionResolved, openPlan });
    void recordMessageSent();
  }, [
    activeReplyClientId,
    effectivePlan,
    entitlementLoaded,
    subscriptionResolved,
    openPlan,
    recordMessageSent,
  ]);
}
