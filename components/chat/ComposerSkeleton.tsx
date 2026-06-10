// Boot-time placeholder for the composer cluster — shown while entitlement
// state is still loading (chat.tsx renders neither the composer nor the
// upgrade block until it knows which one applies).
//
// Mirrors the real layout's exact geometry — the input pill (PILL_RADIUS * 2
// tall) and the accessory chip row (circle + three lozenges) — so when the
// real composer mounts it lands pixel-for-pixel on the skeleton's shapes and
// the swap reads as "the UI filled in," not "a loader was replaced." This
// also retires the second brainrot avatar that used to sit here, duplicating
// the one already loading in the thread above.
//
// The shimmer is a soft highlight band sweeping each shape, driven by one
// shared loop so the row breathes in unison.

import { PILL_RADIUS } from "@/components/ChatInput";
import { COMPOSER_CHIP_HEIGHT } from "@/components/chat/ComposerToggles";
import { withAlpha } from "@/domain/customization";
import { useTheme } from "@/hooks/useTheme";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";
import { useEffect, useState } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

// One sweeping highlight band inside a rounded placeholder shape. The band's
// travel is derived from the shape's measured width so wide (pill) and small
// (circle) shapes sweep edge-to-edge at the same cadence.
function ShimmerBlock({
  progress,
  highlightPeak,
  baseColor,
  style,
}: {
  progress: SharedValue<number>;
  // Peak alpha of the white highlight — stronger on light surfaces, faint in
  // dark mode where a bright band would glare.
  highlightPeak: number;
  baseColor: string;
  style: StyleProp<ViewStyle>;
}) {
  const [width, setWidth] = useState(0);

  const bandStyle = useAnimatedStyle(() => {
    const band = Math.max(width * 0.45, 48);
    return {
      width: band,
      transform: [
        {
          translateX: interpolate(
            progress.value,
            [0, 1],
            [-band, width + band],
          ),
        },
      ],
    };
  }, [width]);

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[{ backgroundColor: baseColor, overflow: "hidden" }, style]}
    >
      {width > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[{ position: "absolute", top: 0, bottom: 0 }, bandStyle]}
        >
          <LinearGradient
            // Alpha-zero of the same hue at the edges (not "transparent",
            // which fringes gray on iOS).
            colors={[
              withAlpha("#FFFFFF", 0),
              withAlpha("#FFFFFF", highlightPeak),
              withAlpha("#FFFFFF", 0),
            ]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

export function ComposerSkeleton() {
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.quad) }),
      -1,
      false,
    );
  }, [progress]);

  const baseColor = theme["--color-background-muted"];
  const highlightPeak = colorScheme === "dark" ? 0.06 : 0.55;

  const chip = (flex: boolean): StyleProp<ViewStyle> => ({
    height: COMPOSER_CHIP_HEIGHT,
    borderRadius: COMPOSER_CHIP_HEIGHT / 2,
    ...(flex ? { flex: 1 } : { width: COMPOSER_CHIP_HEIGHT }),
  });

  return (
    // Pure placeholder — hidden from assistive tech so a screen reader never
    // lands on empty shapes (the thread's loader already announces loading).
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Composer pill at its resting (single-line) height. */}
      <ShimmerBlock
        progress={progress}
        highlightPeak={highlightPeak}
        baseColor={baseColor}
        style={{ height: PILL_RADIUS * 2, borderRadius: PILL_RADIUS }}
      />
      {/* Accessory row: camera circle + three flexible chips, matching the
          gap/margins of the real row in chat.tsx. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          marginTop: 8,
        }}
      >
        <ShimmerBlock
          progress={progress}
          highlightPeak={highlightPeak}
          baseColor={baseColor}
          style={chip(false)}
        />
        <ShimmerBlock
          progress={progress}
          highlightPeak={highlightPeak}
          baseColor={baseColor}
          style={chip(true)}
        />
        <ShimmerBlock
          progress={progress}
          highlightPeak={highlightPeak}
          baseColor={baseColor}
          style={chip(true)}
        />
        <ShimmerBlock
          progress={progress}
          highlightPeak={highlightPeak}
          baseColor={baseColor}
          style={chip(true)}
        />
      </View>
    </View>
  );
}
