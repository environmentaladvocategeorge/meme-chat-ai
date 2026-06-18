import { AppPressable } from "@/components/AppPressable";
import { MemeAvatar, type MemeAvatarVariant } from "@/components/MemeAvatar";
import { Typography } from "@/components/Typography";
import { MAX_PERSONAS_PER_CONVERSATION } from "@/domain/personas";
import { type UsageState } from "@/domain/usage";
import { useResetCountdown } from "@/hooks/useResetCountdown";
import { useTheme } from "@/hooks/useTheme";
import { gradients } from "@/nativewind-theme";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";
import { X } from "phosphor-react-native";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { UpgradeButton } from "./UpgradeButton";

// Shared "block that replaces the composer" shell: avatar + title + body, with
// an action area (one or more buttons) below. Both the usage limit and the
// per-conversation bot limit render through this so the two gates look like one
// consistent treatment in the composer dock.
function ComposerBlock({
  avatarVariant,
  title,
  body,
  children,
}: {
  avatarVariant: MemeAvatarVariant;
  title: string;
  body: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        padding: 14,
        borderRadius: 20,
        backgroundColor: theme["--color-card"],
        borderWidth: 1,
        borderColor: theme["--color-border"],
      }}
    >
      <MemeAvatar variant={avatarVariant} size={48} pulse />
      <View style={{ flex: 1, gap: 8 }}>
        <View>
          <Typography
            variant="body"
            weight="semibold"
            style={{ color: theme["--color-foreground"] }}
          >
            {title}
          </Typography>
          <Typography
            variant="caption"
            style={{
              color: theme["--color-foreground-secondary"],
              marginTop: 1,
            }}
          >
            {body}
          </Typography>
        </View>
        {children}
      </View>
    </View>
  );
}

// Inline 90% nudge above the composer. Cute, compact, dismissible — a single
// tap takes the user to Plan & Usage.
export function UsageNudge({
  usage,
  isTopTier,
  onUpgrade,
}: {
  usage: UsageState;
  isTopTier: boolean;
  onUpgrade: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [dismissed, setDismissed] = useState(false);
  const when = useResetCountdown(usage.bindingResetAt);

  if (dismissed) return null;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginBottom: 8,
        padding: 12,
        borderRadius: 16,
        backgroundColor: theme["--color-warning-muted"],
        borderWidth: 1,
        borderColor: theme["--color-warning"],
      }}
    >
      <MemeAvatar variant="worried" size={40} />
      <View style={{ flex: 1 }}>
        <Typography
          variant="body-sm"
          weight="semibold"
          style={{ color: theme["--color-foreground"] }}
        >
          {t("chat.usage.nearTitle")}
        </Typography>
        <Typography
          variant="caption"
          style={{ color: theme["--color-foreground-secondary"], marginTop: 1 }}
        >
          {t("chat.usage.nearBody", {
            percent: usage.bindingPercentLeft,
            when,
          })}
        </Typography>
      </View>
      <AppPressable
        accessibilityLabel={
          isTopTier ? t("chat.usage.seeLimits") : t("chat.usage.upgrade")
        }
        onPress={onUpgrade}
        haptic
        feedback="opacity"
        hitSlop={6}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 999,
          backgroundColor: theme["--color-primary"],
        }}
      >
        <Typography
          variant="caption"
          style={{
            color: theme["--color-primary-foreground"],
            fontWeight: "800",
          }}
        >
          {isTopTier ? t("chat.usage.seeLimits") : t("chat.usage.upgrade")}
        </Typography>
      </AppPressable>
      <AppPressable
        accessibilityLabel={t("chat.usage.dismiss")}
        onPress={() => setDismissed(true)}
        feedback="opacity"
        hitSlop={8}
        style={{ paddingLeft: 2 }}
      >
        <X size={16} color={theme["--color-foreground-muted"]} weight="bold" />
      </AppPressable>
    </View>
  );
}

// 100% block that replaces the composer. Typing into a spent allowance does
// nothing, so we trade the input for a clear upgrade path.
export function UsageLimitBlock({
  usage,
  isTopTier,
  onUpgrade,
}: {
  usage: UsageState;
  isTopTier: boolean;
  onUpgrade: () => void;
}) {
  const { t } = useTranslation();
  const when = useResetCountdown(usage.bindingResetAt);

  return (
    <ComposerBlock
      avatarVariant="worried"
      title={t("chat.usage.atTitle")}
      // Top tier has nothing to upgrade to, so its body never mentions it.
      body={t(isTopTier ? "chat.usage.atBodyTopTier" : "chat.usage.atBody", { when })}
    >
      <UpgradeButton isTopTier={isTopTier} onPress={onUpgrade} height={44} />
    </ComposerBlock>
  );
}

// Block that replaces the composer when the user switches to a brand-new bot in
// a conversation that already holds the max distinct bots (see
// MAX_PERSONAS_PER_CONVERSATION). Five bots in one thread is plenty; rather than
// silently dropping the send we offer the two ways forward: start a fresh chat,
// or pick a bot already in this thread.
export function PersonaLimitBlock({
  onNewChat,
  onChooseAnother,
}: {
  onNewChat: () => void;
  onChooseAnother: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const gradient = gradients[colorScheme ?? "light"].primary;

  return (
    <ComposerBlock
      avatarVariant="cool"
      title={t("chat.personaLimit.title")}
      body={t("chat.personaLimit.body", { max: MAX_PERSONAS_PER_CONVERSATION })}
    >
      <View style={{ flexDirection: "row", gap: 10 }}>
        {/* Primary: start fresh — the gradient CTA, matching the usage block. */}
        <AppPressable
          accessibilityLabel={t("chat.personaLimit.newChat")}
          onPress={onNewChat}
          haptic
          feedback="opacity"
          containerStyle={{ flex: 1 }}
          style={{ height: 44, borderRadius: 22, overflow: "hidden" }}
        >
          <LinearGradient
            colors={gradient.colors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          >
            <Typography
              variant="title-sm"
              style={{ color: "#FFFFFF", fontWeight: "800" }}
            >
              {t("chat.personaLimit.newChat")}
            </Typography>
          </View>
        </AppPressable>
        {/* Secondary: stay in this thread but pick an existing bot — a quiet
            bordered button so the primary action reads first. */}
        <AppPressable
          accessibilityLabel={t("chat.personaLimit.chooseAnother")}
          onPress={onChooseAnother}
          haptic
          feedback="opacity"
          containerStyle={{ flex: 1 }}
          style={{
            height: 44,
            borderRadius: 22,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: theme["--color-border"],
            backgroundColor: theme["--color-background-muted"],
          }}
        >
          <Typography
            variant="title-sm"
            style={{ color: theme["--color-foreground"], fontWeight: "800" }}
          >
            {t("chat.personaLimit.chooseAnother")}
          </Typography>
        </AppPressable>
      </View>
    </ComposerBlock>
  );
}
