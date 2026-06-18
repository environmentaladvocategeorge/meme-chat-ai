// "Let AI write your description" — a text button on the Who-are-they step that
// writes the identity paragraph from whatever the creator has entered so far
// (name, tagline, vibe, humor). Billed to the user via a cheap nano call; a
// local 1-minute cooldown matches the avatar regenerator.

import { AppPressable } from "@/components/AppPressable";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { useResetCountdown } from "@/hooks/useResetCountdown";
import { useOpenPlan } from "@/hooks/useOpenPlan";
import type { PersonaFormValues } from "@/domain/personaForm";
import { computeUsageState } from "@/domain/usage";
import { useDisplayPlan, useEntitlementStore } from "@/store/entitlement";
import {
  AVATAR_REGEN_COOLDOWN_MS,
} from "@/services/firebase/generatePersonaAvatar";
import {
  generatePersonaDescription,
  PersonaDescriptionError,
  type DescriptionErrorCode,
} from "@/services/firebase/generatePersonaDescription";
import { useCreatorScratch } from "@/components/personaCreator/CreatorScratch";
import { Sparkle } from "phosphor-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert } from "react-native";

export function AiDescriptionButton() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { getValues, setValue } = useFormContext<PersonaFormValues>();
  const openPlan = useOpenPlan();

  // Writing a description draws on the same daily/monthly usage as chat, so
  // pre-gate exactly like the avatar generator: when the binding window is
  // fully spent we swap the "Describe with AI" link for an upgrade prompt
  // (or, on the top tier where there's nothing to move up to, a resets note)
  // instead of offering an action that would just fail.
  const entitlement = useEntitlementStore((s) => s.entitlement);
  const plan = useDisplayPlan();
  const isTopTier = plan === "power";
  const usage = useMemo(
    () =>
      entitlement
        ? computeUsageState({
            plan: entitlement.plan,
            creditsRemaining: entitlement.creditsRemaining,
            monthlyCredits: entitlement.monthlyCredits,
            dailyCreditsUsed: entitlement.dailyCreditsUsed,
            softDailyCredits: entitlement.softDailyCredits,
            creditsResetAt: entitlement.creditsResetAt,
            dailyResetAt: entitlement.dailyResetAt,
            now: Date.now(),
          })
        : null,
    [entitlement],
  );
  const atLimit = usage?.atLimit ?? false;
  const resetWhen = useResetCountdown(usage?.bindingResetAt ?? null);

  // Busy + cooldown live on the screen scratch (above the per-step remount), so
  // a write the user kicked off keeps running behind the scenes when they tap
  // Next/Back: the in-flight promise still drops the result into the form and
  // clears the flag here, and on return the button shows "Writing…" rather than
  // an idle CTA they might tap again and get charged for twice.
  const {
    describeBusy: busy,
    setDescribeBusy: setBusy,
    describeCooldownUntil: cooldownUntil,
    setDescribeCooldownUntil: setCooldownUntil,
  } = useCreatorScratch();
  // Soft client-side rate limit (matches the avatar regenerator): one write a
  // minute. The real spend gate is the usage allowance.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= cooldownUntil) clearInterval(id);
    }, 500);
    return () => clearInterval(id);
  }, [cooldownUntil]);
  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const onCooldown = cooldownLeft > 0;
  const disabled = busy || onCooldown;

  const onPress = useCallback(async () => {
    if (disabled) return;
    setBusy(true);
    try {
      const v = getValues();
      const description = await generatePersonaDescription({
        displayName: v.displayName,
        shortDescription: v.shortDescription,
        toneTags: v.toneTags,
        humorTypes: v.humorTypes,
      });
      setValue("identity", description, { shouldDirty: true, shouldValidate: true });
      setCooldownUntil(Date.now() + AVATAR_REGEN_COOLDOWN_MS);
    } catch (err) {
      const code: DescriptionErrorCode =
        err instanceof PersonaDescriptionError ? err.code : "generation-failed";
      // Quota errors mean there's nothing left to spend — send the user to the
      // same upgrade path as everywhere else instead of a dead-end alert. (The
      // pre-gate below usually catches this first; this covers the race where
      // the allowance runs out mid-tap.) Off the top tier only — MVP has
      // nowhere to upgrade, so it just gets the explanatory alert.
      if ((code === "quota-daily" || code === "quota-monthly") && !isTopTier) {
        openPlan();
      } else {
        Alert.alert(
          t("personasCreator.aiDescribe.errorTitle"),
          t(`personasCreator.aiDescribe.error.${code}`),
        );
      }
    } finally {
      setBusy(false);
    }
  }, [disabled, getValues, setValue, setBusy, setCooldownUntil, t, isTopTier, openPlan]);

  // Out of the shared allowance: surface the same upgrade path the rest of the
  // app uses rather than an action that would just fail. The top tier has
  // nothing to move up to, so it gets a non-tappable resets note (and never
  // any upgrade language).
  if (atLimit) {
    if (isTopTier) {
      return (
        <Typography
          variant="body-sm"
          weight="semibold"
          style={{ color: theme["--color-foreground-muted"], alignSelf: "center", paddingVertical: 6 }}
        >
          {t("personasCreator.aiDescribe.limitTopTier", { when: resetWhen })}
        </Typography>
      );
    }
    return (
      <AppPressable
        onPress={openPlan}
        accessibilityLabel={t("personasCreator.aiDescribe.upgrade")}
        accessibilityRole="button"
        haptic
        feedback="opacity"
        hitSlop={8}
        style={{
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "center",
          gap: 6,
          paddingVertical: 6,
        }}
      >
        <Sparkle size={15} weight="fill" color={theme["--color-primary"]} />
        <Typography variant="body" weight="semibold" style={{ color: theme["--color-primary"] }}>
          {t("personasCreator.aiDescribe.upgrade")}
        </Typography>
      </AppPressable>
    );
  }

  const label = busy
    ? t("personasCreator.aiDescribe.generating")
    : onCooldown
      ? t("personasCreator.aiDescribe.cooldown", { seconds: cooldownLeft })
      : t("personasCreator.aiDescribe.cta");

  // Plain clickable text (no background, no border) — reads as a link, not a
  // button. Dimmed while busy/cooling down.
  return (
    <AppPressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={t("personasCreator.aiDescribe.cta")}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      feedback="opacity"
      hitSlop={8}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "center",
        gap: 6,
        paddingVertical: 6,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={theme["--color-primary"]} />
      ) : (
        <Sparkle size={15} weight="fill" color={theme["--color-primary"]} />
      )}
      <Typography variant="body" weight="semibold" style={{ color: theme["--color-primary"] }}>
        {label}
      </Typography>
    </AppPressable>
  );
}
