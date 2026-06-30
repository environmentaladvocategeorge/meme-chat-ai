import { AppPressable } from "@/components/AppPressable";
import { GlassSurface } from "@/components/GlassSurface";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { Brain } from "phosphor-react-native";
import { useEffect } from "react";
import { type LayoutChangeEvent, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const FADE_MS = 220;

// Subtle "Big Brain is on" status pill in the composer dock, just above the
// input (same slot as the usage nudge). Neutral glass + small, thin, muted text
// so it stays quiet. Tapping it turns Big Brain back off.
//
// Fade in/out: this is ALWAYS mounted and driven by `on` rather than
// conditionally rendered, on purpose. Liquid Glass blanks permanently if a glass
// view (or any ancestor) is ever animated to opacity 0 (see GlassSurface's
// opacity-0 note), so we use the Expo-sanctioned mitigation: the wrapper opacity
// is driven by `progress` AND the same `progress` is handed to GlassSurface via
// `fadeProgress`, which flips the material to 'none' near 0 instead of letting it
// blank. The wrapper also collapses its height (measured once from the inner row)
// so the hidden banner takes no space in the dock.
export function BigBrainBanner({
  on,
  label,
  a11yLabel,
  onPress,
}: {
  on: boolean;
  label: string;
  a11yLabel: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  // 0 = hidden, 1 = shown. Drives wrapper opacity AND (via fadeProgress) the
  // glass material, so the opacity fade is safe for Liquid Glass.
  const progress = useSharedValue(on ? 1 : 0);
  // Natural row height, measured from the inner (unconstrained) view so the
  // wrapper can animate height 0 ↔ content without a measure/animate feedback
  // loop (the inner view is never height-constrained by the wrapper).
  const contentHeight = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(on ? 1 : 0, {
      duration: FADE_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [on, progress]);

  const onContentLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) contentHeight.value = h;
  };

  const wrapperStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    // Before the first measure, leave height auto so the row can size itself
    // (it's invisible at opacity 0 anyway); after, collapse it with progress.
    height:
      contentHeight.value > 0 ? progress.value * contentHeight.value : undefined,
    marginBottom: contentHeight.value > 0 ? progress.value * 8 : 0,
  }));

  return (
    <Animated.View
      style={[wrapperStyle, { overflow: "hidden" }]}
      // The collapsed/hidden banner must never intercept taps.
      pointerEvents={on ? "auto" : "none"}
    >
      <View onLayout={onContentLayout}>
        <AppPressable
          onPress={onPress}
          haptic
          feedback="opacity"
          hitSlop={6}
          accessibilityLabel={a11yLabel}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            paddingVertical: 6,
            paddingHorizontal: 12,
            borderRadius: 12,
            // Surface (glass/fallback fill + border) lives on the layer below.
          }}
        >
          {/* Glass layer — Liquid Glass on iOS 26, a neutral hairline fallback
              elsewhere. fadeProgress keeps the material alive across the fade. */}
          <GlassSurface
            pointerEvents="none"
            style={[StyleSheet.absoluteFillObject, { borderRadius: 12 }]}
            fadeProgress={progress}
            fallbackStyle={{
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme["--color-border"],
              backgroundColor: theme["--color-card"],
            }}
          />
          <Brain
            size={12}
            weight="fill"
            color={theme["--color-foreground-muted"]}
          />
          <Typography
            variant="caption"
            weight="regular"
            numberOfLines={2}
            style={{
              color: theme["--color-foreground-muted"],
              flexShrink: 1,
              fontSize: 11,
              lineHeight: 14,
              textAlign: "center",
            }}
          >
            {label}
          </Typography>
        </AppPressable>
      </View>
    </Animated.View>
  );
}
