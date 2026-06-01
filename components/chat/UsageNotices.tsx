import { AppPressable } from "@/components/AppPressable";
import { MemeAvatar } from "@/components/MemeAvatar";
import { Typography } from "@/components/Typography";
import { type UsageState } from "@/domain/usage";
import { useResetCountdown } from "@/hooks/useResetCountdown";
import { useTheme } from "@/hooks/useTheme";
import { X } from "phosphor-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { UpgradeButton } from "./UpgradeButton";

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
  const theme = useTheme();
  const when = useResetCountdown(usage.bindingResetAt);

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
      <MemeAvatar variant="worried" size={48} pulse />
      <View style={{ flex: 1, gap: 8 }}>
        <View>
          <Typography
            variant="body"
            weight="semibold"
            style={{ color: theme["--color-foreground"] }}
          >
            {t("chat.usage.atTitle")}
          </Typography>
          <Typography
            variant="caption"
            style={{
              color: theme["--color-foreground-secondary"],
              marginTop: 1,
            }}
          >
            {t("chat.usage.atBody", { when })}
          </Typography>
        </View>
        <UpgradeButton isTopTier={isTopTier} onPress={onUpgrade} height={44} />
      </View>
    </View>
  );
}
