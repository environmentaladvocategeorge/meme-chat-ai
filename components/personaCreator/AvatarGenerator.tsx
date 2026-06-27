// AI avatar generation on the persona creator's "Give it a face" step. The user
// types a short description (≤100 chars) and we generate TWO candidates by
// calling the single-image backend twice in PARALLEL. Each tile shimmers until
// its call lands; tapping a result sets it as the persona's local avatar (the
// same { kind: "local" } the photo picker produces), so it rides the existing
// publish → upload → moderate → store path. Generation shares the user's normal
// credit allowance with chat; quota/safety failures surface as inline copy.

import { AppPressable } from "@/components/AppPressable";
import { UpgradeButton } from "@/components/chat/UpgradeButton";
import { Input } from "@/components/Input";
import { useCreatorSession } from "@/components/personaCreator/CreatorSession";
import { useCreatorScratch } from "@/components/personaCreator/CreatorScratch";
import { Shimmer } from "@/components/Shimmer";
import { Typography } from "@/components/Typography";
import { computeUsageState, formatResetMoment } from "@/domain/usage";
import { useOpenPlan } from "@/hooks/useOpenPlan";
import { useTheme } from "@/hooks/useTheme";
import { useDisplayPlan, useEntitlementStore } from "@/store/entitlement";
import {
  AVATAR_DESCRIPTION_MAX,
  AVATAR_REGEN_COOLDOWN_MS,
  AvatarGenerationError,
  deleteLocalAvatars,
  generatePersonaAvatar,
  type AvatarGenerationErrorCode,
} from "@/services/firebase/generatePersonaAvatar";
import type { PickedAvatar } from "@/services/firebase/uploadPersonaAvatar";
import { Image } from "expo-image";
import { Check, Sparkle } from "phosphor-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Keyboard, View } from "react-native";

// Two candidates per generate, called in parallel.
const SLOTS = 2;

function ResultTile({
  picked,
  selected,
  onSelect,
}: {
  picked: PickedAvatar;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <AppPressable
      onPress={onSelect}
      pressScale={0.04}
      accessibilityLabel={t("personasCreator.avatarGen.select")}
      accessibilityState={{ selected }}
      containerStyle={{ flex: 1 }}
      style={{
        flex: 1,
        borderRadius: 20,
        overflow: "hidden",
        borderWidth: selected ? 3 : 1,
        borderColor: selected
          ? theme["--color-primary"]
          : theme["--color-border"],
        backgroundColor: theme["--color-card-muted"],
      }}
    >
      <Image
        source={{ uri: picked.localUri }}
        style={{ flex: 1 }}
        contentFit="cover"
      />
      {selected ? (
        <View
          style={{
            position: "absolute",
            right: 8,
            top: 8,
            width: 26,
            height: 26,
            borderRadius: 13,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme["--color-primary"],
          }}
        >
          <Check
            size={15}
            weight="bold"
            color={theme["--color-primary-foreground"]}
          />
        </View>
      ) : null}
    </AppPressable>
  );
}

// Shown in place of the Generate button when the shared allowance is spent.
// Off the top tier it offers an upgrade; on the top tier (nothing to upgrade to)
// it just says when the allowance refills.
function LimitBlock({
  isTopTier,
  resetAt,
  now,
  onUpgrade,
}: {
  isTopTier: boolean;
  resetAt: Date | null;
  now: number;
  onUpgrade: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  if (isTopTier) {
    return (
      <View
        style={{
          paddingVertical: 14,
          paddingHorizontal: 16,
          borderRadius: 16,
          backgroundColor: theme["--color-card"],
          borderWidth: 1,
          borderColor: theme["--color-border"],
          gap: 4,
        }}
      >
        <Typography
          variant="body-sm"
          weight="semibold"
          style={{ color: theme["--color-foreground"], textAlign: "center" }}
        >
          {t("personasCreator.avatarGen.limitTitle")}
        </Typography>
        <Typography
          variant="caption"
          style={{
            color: theme["--color-foreground-muted"],
            textAlign: "center",
          }}
        >
          {t("personasCreator.avatarGen.limitWait", {
            when: formatResetMoment(resetAt, now, t),
          })}
        </Typography>
      </View>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <Typography
        variant="caption"
        style={{
          color: theme["--color-foreground-muted"],
          textAlign: "center",
        }}
      >
        {t("personasCreator.avatarGen.limitUpgrade")}
      </Typography>
      <UpgradeButton isTopTier={false} onPress={onUpgrade} height={48} />
    </View>
  );
}

export function AvatarGenerator() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { avatar, setLocalAvatar } = useCreatorSession();
  // generatedAvatars lives on the screen (not here) so it survives moving
  // between steps — tapping Next no longer throws the two candidates away.
  const {
    scrollToEnd,
    generatedAvatars,
    setGeneratedAvatars,
    cooldownUntil,
    setCooldownUntil,
    // Busy lives on the screen so a generate the user kicked off keeps showing
    // as "working" (and can't be re-triggered into a double charge) when they
    // step away and back; the in-flight promise still flips it off here.
    avatarBusy: busy,
    setAvatarBusy: setBusy,
  } = useCreatorScratch();
  const [description, setDescription] = useState("");
  const [error, setError] = useState<AvatarGenerationErrorCode | null>(null);

  // Live clock so the cooldown button can count down. Only ticks while a
  // cooldown is active, and stops itself once it elapses.
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

  // Pre-gate on the shared credit allowance so we never show a Generate button
  // that would just error. Avatar generation draws from the same daily/monthly
  // budget as chat, so when the binding window is fully spent we swap the button
  // for an upgrade CTA (or, on the top tier where there's nothing to upgrade to,
  // a "resets {when}" note).
  const entitlement = useEntitlementStore((s) => s.entitlement);
  const plan = useDisplayPlan();
  const openPlan = useOpenPlan();
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
            now,
          })
        : null,
    [entitlement, now],
  );
  const atLimit = usage?.atLimit ?? false;
  const isTopTier = plan === "power";

  const selectedUri = avatar.kind === "local" ? avatar.localUri : null;
  const canGenerate = description.trim().length > 0 && !busy && !onCooldown;
  const hasResults = generatedAvatars.length > 0;

  const generate = useCallback(async () => {
    const desc = description.trim();
    if (!desc || busy) return;
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    // Discard the previous batch's cache files before re-rolling — but keep the
    // one the user may have already selected (it's the live session avatar and
    // gets uploaded on publish).
    const stale = generatedAvatars
      .map((a) => a.localUri)
      .filter((uri) => uri !== selectedUri);
    if (stale.length > 0) void deleteLocalAvatars(stale);
    setGeneratedAvatars([]);

    // Fire both calls in parallel; each appends its candidate as it lands
    // (progressive reveal). The first failure wins the inline error — quota/
    // prompt failures hit both calls identically, so the message is the same.
    // A random rotation + the slot index gives each call a DIFFERENT art
    // direction (so the two don't come back near-identical), and re-rolls the
    // pairing on every regenerate.
    const rotation = Math.floor(Math.random() * 1000);
    let produced = 0;
    const run = (i: number) =>
      generatePersonaAvatar(desc, rotation + i)
        .then((picked) => {
          produced += 1;
          setGeneratedAvatars((prev) => [...prev, picked]);
        })
        .catch((err) =>
          setError(
            (cur) =>
              cur ??
              (err instanceof AvatarGenerationError
                ? err.code
                : "generation-failed"),
          ),
        );

    await Promise.allSettled(Array.from({ length: SLOTS }, (_, i) => run(i)));
    setBusy(false);
    // Soft client-side rate limit: once a batch actually produced images, gate
    // the next regenerate for a minute. A failed run (quota/prompt/network, no
    // images) doesn't start it, so the user can fix the input and retry.
    if (produced > 0) setCooldownUntil(Date.now() + AVATAR_REGEN_COOLDOWN_MS);
  }, [
    description,
    busy,
    generatedAvatars,
    selectedUri,
    setGeneratedAvatars,
    setCooldownUntil,
  ]);

  const errorText = (code: AvatarGenerationErrorCode): string => {
    switch (code) {
      case "quota-daily":
        return t("personasCreator.avatarGen.errorQuotaDaily");
      case "quota-monthly":
        return t("personasCreator.avatarGen.errorQuotaMonthly");
      case "prompt-rejected":
        return t("personasCreator.avatarGen.errorPrompt");
      default:
        return t("personasCreator.avatarGen.errorGeneric");
    }
  };

  return (
    <View style={{ gap: 14 }}>
      {/* Title + description input only make sense when generation is available.
          At the allowance limit we hide them and show just the upgrade/wait
          block (plus any candidates already generated this session). */}
      {!atLimit ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Sparkle size={18} weight="fill" color={theme["--color-primary"]} />
            <View style={{ flex: 1, gap: 2 }}>
              <Typography
                variant="label"
                style={{ color: theme["--color-foreground"] }}
              >
                {t("personasCreator.avatarGen.title")}
              </Typography>
              <Typography
                variant="caption"
                style={{ color: theme["--color-foreground-muted"] }}
              >
                {t("personasCreator.avatarGen.hint")}
              </Typography>
            </View>
          </View>

          <Input
            value={description}
            onChangeText={setDescription}
            placeholder={t("personasCreator.avatarGen.placeholder")}
            limit={AVATAR_DESCRIPTION_MAX}
            showCount
            multiline
            rows={3}
            // The wizard's ScrollView doesn't auto-scroll to a focused field;
            // pull this one above the keyboard once it's up (after the animation).
            onFocus={() => setTimeout(scrollToEnd, 150)}
          />
        </>
      ) : null}

      {atLimit ? (
        // Out of the shared allowance: don't offer a Generate button that would
        // only error. Upgrade path off the top tier; a resets-when note on it.
        <LimitBlock
          isTopTier={isTopTier}
          resetAt={usage?.bindingResetAt ?? null}
          now={now}
          onUpgrade={openPlan}
        />
      ) : (
        <AppPressable
          onPress={generate}
          disabled={!canGenerate}
          accessibilityLabel={
            onCooldown
              ? t("personasCreator.avatarGen.cooldown", {
                  seconds: cooldownLeft,
                })
              : t(
                  hasResults || error
                    ? "personasCreator.avatarGen.regenerate"
                    : "personasCreator.avatarGen.generate",
                )
          }
          pressScale={0.04}
          style={{
            flexDirection: "row",
            gap: 8,
            paddingVertical: 13,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme["--color-card"],
            borderWidth: 1,
            borderColor: theme["--color-primary-muted"],
            opacity: canGenerate ? 1 : 0.5,
          }}
        >
          {busy ? (
            <ActivityIndicator size="small" color={theme["--color-primary"]} />
          ) : (
            <Sparkle size={16} weight="bold" color={theme["--color-primary"]} />
          )}
          <Typography
            variant="body"
            weight="semibold"
            style={{ color: theme["--color-primary"] }}
          >
            {onCooldown
              ? t("personasCreator.avatarGen.cooldown", {
                  seconds: cooldownLeft,
                })
              : t(
                  hasResults || error
                    ? "personasCreator.avatarGen.regenerate"
                    : "personasCreator.avatarGen.generate",
                )}
          </Typography>
        </AppPressable>
      )}

      {error && !busy ? (
        <Typography variant="caption" style={{ color: theme["--color-error"] }}>
          {errorText(error)}
        </Typography>
      ) : null}

      {busy || hasResults ? (
        <View style={{ flexDirection: "row", gap: 12 }}>
          {Array.from({ length: SLOTS }, (_, i) => {
            const picked = generatedAvatars[i];
            return (
              <View key={i} style={{ flex: 1, aspectRatio: 1 }}>
                {picked ? (
                  <ResultTile
                    picked={picked}
                    selected={selectedUri === picked.localUri}
                    onSelect={() =>
                      setLocalAvatar({
                        localUri: picked.localUri,
                        width: picked.width,
                        height: picked.height,
                      })
                    }
                  />
                ) : busy ? (
                  <Shimmer style={{ flex: 1, borderRadius: 20 }} />
                ) : (
                  // A slot whose call failed while the other succeeded: a quiet
                  // labeled placeholder so it reads as "this one didn't come
                  // through" (tap Try again for a fresh pair), not a missing option.
                  <View
                    style={{
                      flex: 1,
                      borderRadius: 20,
                      borderWidth: 1,
                      borderStyle: "dashed",
                      borderColor: theme["--color-border"],
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 10,
                    }}
                  >
                    <Typography
                      variant="caption"
                      style={{ color: theme["--color-foreground-muted"], textAlign: "center" }}
                    >
                      {t("personasCreator.avatarGen.slotFailed")}
                    </Typography>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
