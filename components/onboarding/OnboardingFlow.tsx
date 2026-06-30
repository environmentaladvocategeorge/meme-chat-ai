// OnboardingFlow
//
// The post-signup onboarding host. The flow is now a scripted live conversation
// with Brainrot Bot (OnboardingChat), driven by the pure engine in
// domain/onboarding/script + useOnboardingScript. This component owns only the
// business logic the conversation can't: the notification-permission soft-ask,
// the full-screen paywall + trial intercept the chat hands off to, and finishing
// (committing the captured alias / rot level / intent and marking onboarding
// complete server-side).
//
// Nothing is sent to the backend until finish() — onboarding is "complete" only
// then, which is also when the alias is mirrored to profiles/{uid} and the
// durable onboardingCompleted marker is stamped (so a returning account never
// replays this flow).

import { PlanPaywall } from "@/components/PlanPaywall";
import { markDailyPaywallShownToday } from "@/hooks/useDailyPaywall";
import { updateProfileCallable } from "@/services/firebase/callables";
import { useChatStore } from "@/store/chat";
import { useEffectivePlan } from "@/store/entitlement";
import { useNotificationsStore } from "@/store/notifications";
import { useOnboardingStore } from "@/store/onboarding";
import { useSettingsStore } from "@/store/settings";
import { MAX_ALIAS_LENGTH, MAX_ROT_LEVEL, MIN_ROT_LEVEL } from "@/store/storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingChat } from "./OnboardingChat";
import { OnboardingScaffold } from "./OnboardingScaffold";
import { TrialOfferScreen } from "./TrialOfferScreen";

export function OnboardingFlow() {
  const { t } = useTranslation();

  const setCompleted = useOnboardingStore((s) => s.setCompleted);
  const setAlias = useSettingsStore((s) => s.setAlias);
  const setIntent = useSettingsStore((s) => s.setIntent);
  const setChatRotLevel = useChatStore((s) => s.setRotLevel);
  const requestPermission = useNotificationsStore((s) => s.requestPermission);
  const declineNotifications = useNotificationsStore((s) => s.decline);
  const effectivePlan = useEffectivePlan();

  // The conversation hands off here when it reaches its terminal turn; the
  // paywall + trial are full-screen (not in-chat).
  const [showPaywall, setShowPaywall] = useState(false);
  const [showTrialOffer, setShowTrialOffer] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const finishedRef = useRef(false);

  // Commit everything captured during the conversation, then mark complete.
  // Reads the answers straight from the onboarding store (the engine persisted
  // them there as the user advanced), so this is the single commit point.
  const finish = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setFinishing(true);

    const { answers } = useOnboardingStore.getState();
    const trimmedAlias = (answers.alias ?? "").trim().slice(0, MAX_ALIAS_LENGTH);
    const rotLevel = answers.rotLevel;
    if (rotLevel != null) {
      setChatRotLevel(
        Math.min(Math.max(rotLevel, MIN_ROT_LEVEL), MAX_ROT_LEVEL),
      );
    }
    if (trimmedAlias.length > 0) setAlias(trimmedAlias);
    // Intent steers the first chat's seeded starter prompts (EmptyChatState).
    if (answers.intent) setIntent(answers.intent);

    // The onboarding paywall counts as today's paywall — stop the daily gate
    // from immediately re-opening it the moment they land in the app.
    void markDailyPaywallShownToday();

    try {
      await updateProfileCallable(
        trimmedAlias.length > 0
          ? { alias: trimmedAlias, onboardingCompleted: true }
          : { onboardingCompleted: true },
      );
    } catch (err) {
      // Non-blocking for generic failures: the local alias already advanced the
      // user. But if the alias was rejected for hate speech, clear it so the
      // local state doesn't keep a prohibited name.
      const message = err instanceof Error ? err.message : "";
      if (message.includes("hate_speech_detected")) {
        setAlias("");
      }
    }

    setCompleted(true); // routing dispatcher takes them to /chat
  }, [setAlias, setIntent, setChatRotLevel, setCompleted]);

  // A purchase completed inside PlanPaywall flips the effective plan to a paid
  // tier without navigating — finish the flow when that happens on the paywall.
  useEffect(() => {
    if (showPaywall && effectivePlan !== "free") {
      void finish();
    }
  }, [showPaywall, effectivePlan, finish]);

  // Per-turn side effects fired by the conversation. Only the notification turn
  // has one: tapping "allow" triggers the OS permission prompt (the soft-ask
  // pattern — the in-chat question is the pre-prompt), "decline" records the
  // local opt-out. We don't await; the conversation continues underneath.
  const onBeforeAdvance = useCallback(
    (turnId: string, value: string) => {
      if (turnId !== "notif") return;
      if (value === "allow") void requestPermission();
      else declineNotifications();
    },
    [requestPermission, declineNotifications],
  );

  // Trial offer intercepts "continue free" — only shown to genuinely free users.
  // A paid user (promo, bought during onboarding, existing subscriber) goes
  // straight to finish().
  if (showTrialOffer && effectivePlan === "free") {
    return <TrialOfferScreen onDecline={() => void finish()} />;
  }

  if (showPaywall) {
    const alreadySubscribed = effectivePlan !== "free";
    return (
      <OnboardingScaffold
        title={t("onboarding.paywall.title")}
        ctaLoading={finishing}
        secondaryLabel={
          alreadySubscribed
            ? t("common.continue")
            : t("onboarding.paywall.continueFree")
        }
        onSecondary={
          alreadySubscribed
            ? () => void finish()
            : () => setShowTrialOffer(true)
        }
      >
        <PlanPaywall />
      </OnboardingScaffold>
    );
  }

  return (
    <OnboardingChat
      onBeforeAdvance={onBeforeAdvance}
      onReachedPaywall={() => setShowPaywall(true)}
    />
  );
}
