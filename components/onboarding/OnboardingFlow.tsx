// OnboardingFlow
//
// The post-signup onboarding controller. Holds the step index (persisted via
// the onboarding store so a mid-flow exit resumes here) plus the in-progress
// answers (alias, rot level, notification choice). Each step renders into the
// shared OnboardingScaffold. Nothing is sent to the backend until the very last
// step finishes — onboarding is treated as complete only then, which is also
// when we mirror the alias to profiles/{uid}.

import { Input } from "@/components/Input";
import { PlanPaywall } from "@/components/PlanPaywall";
import { Typography } from "@/components/Typography";
import type { MessageGif } from "@/domain/gifs";
import { trendingGifToMessageGif } from "@/domain/gifs";
import { markDailyPaywallShownToday } from "@/hooks/useDailyPaywall";
import { useTheme } from "@/hooks/useTheme";
import {
  getTrendingGifsCallable,
  updateProfileCallable,
} from "@/services/firebase/callables";
import { useChatStore } from "@/store/chat";
import { useEffectivePlan } from "@/store/entitlement";
import { useNotificationsStore } from "@/store/notifications";
import { useOnboardingStore } from "@/store/onboarding";
import { useSettingsStore } from "@/store/settings";
import { MAX_ALIAS_LENGTH } from "@/store/storage";
import { BellRinging } from "phosphor-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { AgentReadyReveal } from "./AgentReadyReveal";
import { MockChat } from "./MockChat";
import { OnboardingScaffold } from "./OnboardingScaffold";
import { RotLevelDemo } from "./RotLevelDemo";
import { TrialOfferScreen } from "./TrialOfferScreen";

// Step indices — keep in sync with TOTAL_STEPS.
const STEP = {
  value: 0,
  useful: 1,
  memes: 2,
  rot: 3,
  name: 4,
  ready: 5,
  notifications: 6,
  paywall: 7,
} as const;
const TOTAL_STEPS = 8;

export function OnboardingFlow() {
  const { t } = useTranslation();

  const storedStep = useOnboardingStore((s) => s.step);
  const setStoredStep = useOnboardingStore((s) => s.setStep);
  const setCompleted = useOnboardingStore((s) => s.setCompleted);

  const storedAlias = useSettingsStore((s) => s.alias);
  const setAlias = useSettingsStore((s) => s.setAlias);
  const setChatRotLevel = useChatStore((s) => s.setRotLevel);
  const chatRotLevel = useChatStore((s) => s.rotLevel);

  const requestPermission = useNotificationsStore((s) => s.requestPermission);
  const declineNotifications = useNotificationsStore((s) => s.decline);

  const effectivePlan = useEffectivePlan();

  // Resume at the persisted step, clamped into range (defensive against a stale
  // out-of-bounds value from an older build).
  const [step, setStep] = useState(() =>
    Math.min(Math.max(storedStep, 0), TOTAL_STEPS - 1),
  );
  const [aliasDraft, setAliasDraft] = useState(storedAlias);
  const [rotLevel, setRotLevel] = useState(chatRotLevel || 2);
  const [readyDone, setReadyDone] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const finishedRef = useRef(false);
  // When true, the trial offer screen overlays the paywall step.
  const [showTrialOffer, setShowTrialOffer] = useState(false);

  // Pull a couple of real trending GIFs once so the meme/GIF showcase uses live
  // content (the actual Klipy pipeline) rather than canned art. Failures are
  // swallowed — the steps fall back to text-only bubbles.
  const [gifs, setGifs] = useState<MessageGif[]>([]);
  const [gifsLoading, setGifsLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getTrendingGifsCallable({ perPage: 8 });
        if (!cancelled) {
          setGifs(res.gifs.slice(0, 2).map(trendingGifToMessageGif));
        }
      } catch {
        // ignore — text-only fallback
      } finally {
        if (!cancelled) setGifsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const go = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 0), TOTAL_STEPS - 1);
      setStep(clamped);
      setStoredStep(clamped);
    },
    [setStoredStep],
  );

  // Complete onboarding: persist the chosen rot level + alias locally, then
  // (best-effort) mirror the alias to the backend. Only here — once everything
  // is done — do we mark onboarding complete and hit the server.
  const finish = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setFinishing(true);

    const trimmedAlias = aliasDraft.trim().slice(0, MAX_ALIAS_LENGTH);
    setChatRotLevel(rotLevel);
    if (trimmedAlias.length > 0) setAlias(trimmedAlias);

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
  }, [aliasDraft, rotLevel, setAlias, setChatRotLevel, setCompleted]);

  // A purchase completed inside PlanPaywall flips the effective plan to a paid
  // tier without navigating — finish the flow when that happens on the paywall.
  useEffect(() => {
    if (step === STEP.paywall && effectivePlan !== "free") {
      void finish();
    }
  }, [step, effectivePlan, finish]);

  const back = step > 0 ? () => go(step - 1) : undefined;
  const gifLabel = t("onboarding.memes.cta");

  // Trial offer intercepts "continue free" — only shown to genuinely free users.
  // If they already have a paid plan (promo, bought during onboarding, etc.) we
  // never show this screen; the paywall step routes them straight to finish().
  if (showTrialOffer && effectivePlan === "free") {
    return <TrialOfferScreen onDecline={() => void finish()} />;
  }

  switch (step) {
    case STEP.value:
      return (
        <OnboardingScaffold
          step={step}
          total={TOTAL_STEPS}
          title={t("onboarding.value.title")}
          subtitle={t("onboarding.value.body")}
          ctaLabel={t("onboarding.value.cta")}
          onCta={() => go(STEP.useful)}
        >
          <MockChat
            gifLabel={gifLabel}
            messages={[
              { id: "u", from: "user", text: t("onboarding.value.userMsg") },
              {
                id: "b",
                from: "bot",
                text: t("onboarding.value.botMsg"),
                gif: gifs[0] ?? null,
                gifLoading: gifsLoading,
              },
            ]}
          />
        </OnboardingScaffold>
      );

    case STEP.useful:
      return (
        <OnboardingScaffold
          step={step}
          total={TOTAL_STEPS}
          title={t("onboarding.useful.title")}
          subtitle={t("onboarding.useful.body")}
          ctaLabel={t("onboarding.useful.cta")}
          onCta={() => go(STEP.memes)}
          onBack={back}
        >
          <PromptChips
            items={asArray(t("onboarding.useful.prompts", { returnObjects: true }))}
          />
          <MockChat
            gifLabel={gifLabel}
            messages={[
              { id: "u", from: "user", text: t("onboarding.useful.prompts.2") },
              { id: "b", from: "bot", text: t("onboarding.useful.botPreview") },
            ]}
          />
        </OnboardingScaffold>
      );

    case STEP.memes:
      return (
        <OnboardingScaffold
          step={step}
          total={TOTAL_STEPS}
          title={t("onboarding.memes.title")}
          subtitle={t("onboarding.memes.body")}
          ctaLabel={t("onboarding.memes.cta")}
          onCta={() => go(STEP.rot)}
          onBack={back}
        >
          <MockChat
            gifLabel={gifLabel}
            messages={[
              {
                id: "u",
                from: "user",
                text: t("onboarding.memes.userMsg"),
                gif: gifs[0] ?? null,
                gifLoading: gifsLoading,
              },
              {
                id: "b",
                from: "bot",
                text: t("onboarding.memes.botMsg"),
                gif: gifs[1] ?? null,
                gifLoading: gifsLoading,
              },
            ]}
          />
        </OnboardingScaffold>
      );

    case STEP.rot:
      return (
        <OnboardingScaffold
          step={step}
          total={TOTAL_STEPS}
          title={t("onboarding.rot.title")}
          subtitle={t("onboarding.rot.body")}
          ctaLabel={t("onboarding.rot.cta")}
          onCta={() => go(STEP.name)}
          onBack={back}
        >
          <RotLevelDemo value={rotLevel} onChange={setRotLevel} />
        </OnboardingScaffold>
      );

    case STEP.name:
      return (
        <OnboardingScaffold
          step={step}
          total={TOTAL_STEPS}
          title={t("onboarding.name.title")}
          ctaLabel={t("onboarding.name.cta")}
          onCta={() => {
            const trimmed = aliasDraft.trim();
            if (trimmed.length > 0) setAlias(trimmed);
            go(STEP.ready);
          }}
          secondaryLabel={t("onboarding.name.skip")}
          onSecondary={() => {
            setAliasDraft("");
            go(STEP.ready);
          }}
          onBack={back}
        >
          <Input
            placeholder={t("onboarding.name.placeholder")}
            value={aliasDraft}
            onChangeText={setAliasDraft}
            maxLength={MAX_ALIAS_LENGTH}
            autoCapitalize="words"
            returnKeyType="done"
          />
          <Microcopy text={t("onboarding.name.microcopy")} />
        </OnboardingScaffold>
      );

    case STEP.ready:
      return (
        <OnboardingScaffold
          step={step}
          total={TOTAL_STEPS}
          ctaLabel={t("onboarding.ready.cta")}
          // Hard guard in addition to ctaDisabled: never advance until the
          // reveal animation has finished, even if the disabled styling is
          // somehow bypassed.
          onCta={() => {
            if (readyDone) go(STEP.notifications);
          }}
          ctaDisabled={!readyDone}
          onBack={back}
        >
          <AgentReadyReveal onReadyChange={setReadyDone} />
        </OnboardingScaffold>
      );

    case STEP.notifications:
      return (
        <OnboardingScaffold
          step={step}
          total={TOTAL_STEPS}
          title={t("onboarding.notifications.title")}
          subtitle={t("onboarding.notifications.body")}
          ctaLabel={t("onboarding.notifications.allow")}
          onCta={async () => {
            await requestPermission();
            go(STEP.paywall);
          }}
          secondaryLabel={t("onboarding.notifications.decline")}
          onSecondary={() => {
            declineNotifications();
            go(STEP.paywall);
          }}
          onBack={back}
        >
          <NotificationExamples
            items={asArray(
              t("onboarding.notifications.examples", { returnObjects: true }),
            )}
          />
        </OnboardingScaffold>
      );

    case STEP.paywall:
    default: {
      // Users who already have a paid plan (promo code, bought during this
      // onboarding flow, or existing subscriber) should skip the trial offer
      // and just continue. Only free users get the trial intercept.
      const alreadySubscribed = effectivePlan !== "free";
      return (
        <OnboardingScaffold
          step={STEP.paywall}
          total={TOTAL_STEPS}
          title={t("onboarding.paywall.title")}
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
          onBack={back}
        >
          <PlanPaywall />
        </OnboardingScaffold>
      );
    }
  }
}

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

function Microcopy({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Typography
      variant="caption"
      style={{ color: theme["--color-foreground-muted"] }}
    >
      {text}
    </Typography>
  );
}

function PromptChips({ items }: { items: string[] }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {items.map((item) => (
        <View
          key={item}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 999,
            backgroundColor: theme["--color-primary-subtle"],
            borderWidth: 1,
            borderColor: theme["--color-primary-muted"],
          }}
        >
          <Typography
            variant="body-sm"
            style={{ color: theme["--color-primary"], fontWeight: "600" }}
          >
            {item}
          </Typography>
        </View>
      ))}
    </View>
  );
}

function NotificationExamples({ items }: { items: string[] }) {
  const theme = useTheme();
  return (
    <View
      style={{
        borderRadius: 16,
        backgroundColor: theme["--color-card"],
        borderWidth: 1,
        borderColor: theme["--color-border"],
        overflow: "hidden",
      }}
    >
      {items.map((ex, i) => (
        <View
          key={ex}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingVertical: 14,
            paddingHorizontal: 14,
            borderTopWidth: i === 0 ? 0 : 1,
            borderTopColor: theme["--color-border"],
          }}
        >
          <BellRinging size={18} color={theme["--color-primary"]} weight="fill" />
          <Typography
            variant="body"
            style={{ color: theme["--color-foreground"], flex: 1 }}
          >
            {ex}
          </Typography>
        </View>
      ))}
    </View>
  );
}
