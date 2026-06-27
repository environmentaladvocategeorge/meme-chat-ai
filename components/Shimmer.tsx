// Shimmer
//
// The app's single skeleton/loading primitive: a rounded placeholder with a
// soft highlight band sweeping across it. Replaces the three near-identical
// copies that lived in ComposerSkeleton, AppHeader's PersonaPillSkeleton, and
// the avatar generator.
//
// Pass `progress` to drive several blocks from one shared loop (so a row of
// shapes breathes in unison); omit it and the block runs its own loop.

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

export const SHIMMER_DURATION = 1300;

export function Shimmer({
  style,
  progress: external,
}: {
  // Shape of the placeholder (size + borderRadius). A `backgroundColor` here
  // overrides the default muted base.
  style?: StyleProp<ViewStyle>;
  // Optional shared driver so multiple blocks sweep in unison.
  progress?: SharedValue<number>;
}) {
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const [width, setWidth] = useState(0);

  const own = useSharedValue(0);
  const progress = external ?? own;
  useEffect(() => {
    if (external) return; // caller drives the loop
    own.value = withRepeat(
      withTiming(1, {
        duration: SHIMMER_DURATION,
        easing: Easing.inOut(Easing.quad),
      }),
      -1,
      false,
    );
  }, [external, own]);

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

  // Stronger highlight on light surfaces; faint in dark mode where a bright band
  // would glare.
  const peak = colorScheme === "dark" ? 0.06 : 0.5;

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[
        {
          backgroundColor: theme["--color-background-muted"],
          overflow: "hidden",
        },
        style,
      ]}
    >
      {width > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[{ position: "absolute", top: 0, bottom: 0 }, bandStyle]}
        >
          <LinearGradient
            // Alpha-zero of the same hue at the edges (not "transparent", which
            // fringes gray on iOS).
            colors={[
              withAlpha("#FFFFFF", 0),
              withAlpha("#FFFFFF", peak),
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
