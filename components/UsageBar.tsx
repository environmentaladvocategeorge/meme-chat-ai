// UsageBar
//
// Playful percentage-based allowance indicator. Shows what's *left* of a
// single allowance window (monthly budget OR daily soft cap) — animated from
// 0 to the live percent on mount + on every change. The plan page renders one
// per window so the daily-vs-monthly distinction is explicit.
//
// The fill is a brand gradient; near-empty windows tint the percentage label
// with the warning color so a binding limit reads at a glance.

import { Typography } from "@/components/Typography";
import { usageTier } from "@/domain/usage";
import { useResetCountdown } from "@/hooks/useResetCountdown";
import { useTheme } from "@/hooks/useTheme";
import { gradients } from "@/nativewind-theme";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LayoutChangeEvent, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const BAR_HEIGHT = 18;
const BAR_RADIUS = BAR_HEIGHT / 2;

interface UsageBarProps {
  title: string;
  remaining: number;
  total: number;
  resetAt: Date | null;
  // i18n key for the reset caption; receives `{{when}}` (e.g. "Refills
  // {{when}}" → "Refills in 5 hours and 12 minutes").
  resetCopyKey: string;
}

export function UsageBar({
  title,
  remaining,
  total,
  resetAt,
  resetCopyKey,
}: UsageBarProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme ?? "light";

  const safeTotal = total > 0 ? total : 1;
  const ratio = Math.max(0, Math.min(1, remaining / safeTotal));
  const percent = Math.round(ratio * 100);

  // The fill + percentage tint both step from brand → amber → red as the
  // remaining allowance shrinks, so the bar signals "running low" on its own.
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
        : theme["--color-primary"];

  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(ratio, {
      duration: 700,
      easing: Easing.out(Easing.cubic),
    });
  }, [ratio, progress]);

  const [barWidth, setBarWidth] = useState(0);
  const onBarLayout = (event: LayoutChangeEvent) => {
    setBarWidth(event.nativeEvent.layout.width);
  };

  const fillStyle = useAnimatedStyle(() => ({
    width: barWidth * progress.value,
  }));

  const when = useResetCountdown(resetAt);
  const resetLabel = t(resetCopyKey, { when });

  return (
    <View style={{ gap: 10 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <Typography variant="title-sm" style={{ color: theme["--color-foreground"] }}>
          {title}
        </Typography>
        <Typography
          variant="title-md"
          style={{
            color: percentColor,
            fontWeight: "800",
          }}
        >
          {t("settings.plan.usageRemaining", { percent })}
        </Typography>
      </View>

      <View
        onLayout={onBarLayout}
        style={{
          width: "100%",
          height: BAR_HEIGHT,
          borderRadius: BAR_RADIUS,
          backgroundColor: theme["--color-card-muted"],
          overflow: "hidden",
        }}
      >
        <Animated.View
          style={[
            {
              height: "100%",
              borderRadius: BAR_RADIUS,
              overflow: "hidden",
            },
            fillStyle,
          ]}
        >
          <LinearGradient
            colors={gradient.colors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>
      </View>

      <Typography
        variant="caption"
        style={{ color: theme["--color-foreground-secondary"] }}
      >
        {resetLabel}
      </Typography>
    </View>
  );
}
