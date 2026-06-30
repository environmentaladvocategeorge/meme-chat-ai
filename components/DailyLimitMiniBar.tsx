// DailyLimitMiniBar
//
// A small, subtle teaser of "today's limit" that sits on the Plan & Usage
// settings card: a tiny label, a slim progress bar, and a trailing percentage.
// It mirrors the daily bar inside the plan sheet (same remaining-ratio math and
// the same brand → amber → red color tiers) so tapping the card to "see more"
// tells a consistent story. Renders nothing until the entitlement has loaded.

import { Typography } from "@/components/Typography";
import { usageTier } from "@/domain/usage";
import { useResetCountdown } from "@/hooks/useResetCountdown";
import { useTheme } from "@/hooks/useTheme";
import { gradients } from "@/nativewind-theme";
import { useEntitlementStore } from "@/store/entitlement";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

const BAR_HEIGHT = 6;
const BAR_RADIUS = BAR_HEIGHT / 2;

export function DailyLimitMiniBar() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme ?? "light";
  const entitlement = useEntitlementStore((s) => s.entitlement);
  // Hook must run unconditionally — safe to pass null before the entitlement
  // loads; the countdown only matters once the limit is spent below.
  const resetWhen = useResetCountdown(entitlement?.dailyResetAt ?? null);

  if (!entitlement) return null;

  const total = entitlement.softDailyCredits > 0 ? entitlement.softDailyCredits : 1;
  const remaining = Math.max(
    0,
    entitlement.softDailyCredits - entitlement.dailyCreditsUsed,
  );
  const ratio = Math.max(0, Math.min(1, remaining / total));
  const percent = Math.round(ratio * 100);

  const tier = usageTier(ratio);
  const gradient =
    tier === "danger"
      ? gradients[scheme].danger
      : tier === "warning"
        ? gradients[scheme].warning
        : gradients[scheme].primary;
  const percentColor =
    tier === "danger"
      ? theme["--color-error"]
      : tier === "warning"
        ? theme["--color-warning"]
        : theme["--color-foreground-muted"];

  // Once today's limit is spent, the "Today's limit" label is no longer the
  // useful thing to show — swap it for a live "Resets in {x}" countdown.
  const spent = remaining <= 0;
  const label = spent
    ? t("settings.plan.dailyReset", { when: resetWhen })
    : t("settings.plan.dailyTitle");

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Typography
        variant="caption"
        numberOfLines={1}
        style={{ color: theme["--color-foreground-muted"] }}
      >
        {label}
      </Typography>
      <View
        style={{
          flex: 1,
          height: BAR_HEIGHT,
          borderRadius: BAR_RADIUS,
          backgroundColor: theme["--color-card-muted"],
          overflow: "hidden",
        }}
      >
        <View
          style={{
            height: "100%",
            width: `${percent}%`,
            borderRadius: BAR_RADIUS,
            overflow: "hidden",
          }}
        >
          <LinearGradient
            colors={gradient.colors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFillObject}
          />
        </View>
      </View>
      <Typography
        variant="caption"
        weight="semibold"
        style={{ color: percentColor }}
      >
        {`${percent}%`}
      </Typography>
    </View>
  );
}
