// AppHeader
//
// The top "card" region that sits at the top of every screen inside the
// (app) group. Renders:
//
//   - A slightly elevated card surface with rounded bottom corners.
//   - A row containing the inline menu button (left), the centered title
//     (middle), and a balancing spacer (right). Putting the button inline
//     with the title guarantees they share vertical centering through flex
//     alignment rather than fighting font metrics.
//   - A scattering of slow-twinkling `Sparkle` icons concentrated in the
//     two bands that flank the title — between the button and the title on
//     the left, and between the title and the right edge.

import { MENU_BUTTON_SIZE, MenuButton } from "@/components/MenuButton";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { Sparkle } from "phosphor-react-native";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type SparkleSpec = {
  // Position is relative to the card's safe-area top; we re-add the inset
  // at render time so positions stay consistent across devices.
  top: number;
  side: "left" | "right";
  offset: number;
  size: number;
  duration: number;
  delay: number;
  tint: "primary" | "secondary" | "warning";
};

// Positions are tuned to fill the two "gaps" that flank the centered title:
// the band between the menu button and "Chat" on the left, and the band
// between "Chat" and the right edge.
const SPARKLES: readonly SparkleSpec[] = [
  // Left gap (between the menu button and the title)
  { top: 6, side: "left", offset: 72, size: 9, duration: 4200, delay: 0, tint: "secondary" },
  { top: 30, side: "left", offset: 90, size: 11, duration: 3600, delay: 1500, tint: "primary" },
  { top: 18, side: "left", offset: 122, size: 8, duration: 4500, delay: 700, tint: "warning" },
  { top: 40, side: "left", offset: 108, size: 9, duration: 3300, delay: 2400, tint: "primary" },
  // Right gap (between the title and the right edge)
  { top: 4, side: "right", offset: 78, size: 11, duration: 3900, delay: 600, tint: "primary" },
  { top: 28, side: "right", offset: 108, size: 12, duration: 4500, delay: 1900, tint: "secondary" },
  { top: 14, side: "right", offset: 132, size: 8, duration: 4200, delay: 300, tint: "warning" },
  { top: 38, side: "right", offset: 70, size: 9, duration: 3600, delay: 2700, tint: "primary" },
  { top: 22, side: "right", offset: 28, size: 13, duration: 4800, delay: 1100, tint: "secondary" },
];

interface AppHeaderProps {
  title: string;
}

export function AppHeader({ title }: AppHeaderProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        // The safe-area top inset reserves room for the status bar, but
        // the status bar glyphs only occupy a thin band at its very top —
        // the remainder reads as empty space above the button. So we keep
        // the top padding tight (small +2 on top of the inset) and add
        // matching breathing room below so the button looks optically
        // centered within the visible header rather than shoved against
        // the card's lower edge.
        paddingTop: insets.top + 2,
        paddingBottom: 16,
        paddingHorizontal: 16,
        backgroundColor: theme["--color-card"],
        borderBottomLeftRadius: 28,
        borderBottomRightRadius: 28,
        shadowColor: theme["--color-foreground"],
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
        overflow: "hidden",
      }}
    >
      {/* Sparkle field, behind the title row (zIndex 0). */}
      <View
        pointerEvents="none"
        style={StyleSheet.absoluteFillObject}
      >
        {SPARKLES.map((s, i) => (
          <AnimatedSparkle
            key={i}
            spec={s}
            insetsTop={insets.top}
            color={
              s.tint === "primary"
                ? theme["--color-primary"]
                : s.tint === "secondary"
                  ? theme["--color-secondary"]
                  : theme["--color-warning"]
            }
          />
        ))}
      </View>

      {/* Title row: button on the left, title flex-centered in the middle,
          a matching-width spacer on the right so the title is geometrically
          centered. Sharing a flex row guarantees vertical alignment. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          height: MENU_BUTTON_SIZE,
        }}
      >
        <MenuButton />
        <View style={{ flex: 1, alignItems: "center", paddingHorizontal: 8 }}>
          <Typography
            variant="title-xl"
            style={{ color: theme["--color-foreground"], textAlign: "center" }}
            numberOfLines={1}
          >
            {title}
          </Typography>
        </View>
        <View style={{ width: MENU_BUTTON_SIZE }} />
      </View>
    </View>
  );
}

function AnimatedSparkle({
  spec,
  insetsTop,
  color,
}: {
  spec: SparkleSpec;
  insetsTop: number;
  color: string;
}) {
  const opacity = useSharedValue(0.25);
  const scale = useSharedValue(0.7);

  useEffect(() => {
    opacity.value = withDelay(
      spec.delay,
      withRepeat(
        withSequence(
          withTiming(0.9, {
            duration: spec.duration,
            easing: Easing.inOut(Easing.quad),
          }),
          withTiming(0.2, {
            duration: spec.duration,
            easing: Easing.inOut(Easing.quad),
          }),
        ),
        -1,
        false,
      ),
    );
    scale.value = withDelay(
      spec.delay,
      withRepeat(
        withSequence(
          withTiming(1, {
            duration: spec.duration,
            easing: Easing.inOut(Easing.quad),
          }),
          withTiming(0.7, {
            duration: spec.duration,
            easing: Easing.inOut(Easing.quad),
          }),
        ),
        -1,
        false,
      ),
    );
  }, [opacity, scale, spec.delay, spec.duration]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          top: insetsTop + spec.top,
          [spec.side]: spec.offset,
        },
        animatedStyle,
      ]}
    >
      <Sparkle size={spec.size} color={color} weight="fill" />
    </Animated.View>
  );
}
