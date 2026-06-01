// Visual menu button. Renders the gradient circle with the cross-fading
// List/X icons and the press-pulse + rotate animation. Lives inline inside
// AppHeader so it shares a row (and therefore vertical centering) with the
// title text. State comes from `useMenuStore` so the matching overlay
// (mounted once at the (app) layout level) stays in sync.

import { useChatAccentGradient, useTheme } from "@/hooks/useTheme";
import { tapHaptic } from "@/lib/haptics";
import { gradients } from "@/nativewind-theme";
import { useMenuStore } from "@/store/menu";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";
import { List, X } from "phosphor-react-native";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet } from "react-native";
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

export const MENU_BUTTON_SIZE = 46;
const TAP_SPRING = { damping: 14, stiffness: 220, mass: 0.8 } as const;

export function MenuButton() {
  const { t } = useTranslation();
  const theme = useTheme();
  const chatAccentGradient = useChatAccentGradient();
  const { colorScheme } = useColorScheme();
  const primaryGradient = gradients[colorScheme ?? "light"].primary;
  const gradientColors = chatAccentGradient ?? primaryGradient.colors;
  const gradientStart = chatAccentGradient ? { x: 0, y: 0 } : primaryGradient.start;
  const gradientEnd = chatAccentGradient ? { x: 1, y: 1 } : primaryGradient.end;
  const iconColor = chatAccentGradient
    ? theme["--color-primary-foreground"]
    : "#FFFFFF";
  const open = useMenuStore((s) => s.open);
  const toggle = useMenuStore((s) => s.toggle);

  const progress = useSharedValue(0);
  const pressed = useSharedValue(0);

  useEffect(() => {
    progress.value = withSpring(open ? 1 : 0, TAP_SPRING);
  }, [open, progress]);

  const onPress = () => {
    tapHaptic();
    toggle();
  };

  // Scale + rotate live on a pointerEvents="none" child, never on the Pressable
  // itself: animating the touch target desyncs Fabric's hit-test frame in
  // release builds, so taps land in the wrong place (or miss) until a re-layout
  // refreshes it — the "spam-tap until it opens" bug. The press feedback is
  // driven by onPressIn/onPressOut so the button flinches the instant a finger
  // lands, which also makes a dropped tap visible (no flinch = touch missed).
  const visualStyle = useAnimatedStyle(() => {
    const rotate = interpolate(progress.value, [0, 1], [0, 90]);
    const scale = 1 - pressed.value * 0.12;
    return {
      transform: [{ scale }, { rotate: `${rotate}deg` }],
    };
  });

  const listStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ scale: 1 - progress.value * 0.4 }],
  }));

  const closeStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.6 + progress.value * 0.4 }],
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: 80 });
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, TAP_SPRING);
      }}
      accessibilityRole="button"
      accessibilityLabel={t(open ? "menu.close" : "menu.open")}
      accessibilityState={{ expanded: open }}
      hitSlop={8}
      style={{
        width: MENU_BUTTON_SIZE,
        height: MENU_BUTTON_SIZE,
        borderRadius: MENU_BUTTON_SIZE / 2,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          {
            ...StyleSheet.absoluteFillObject,
            borderRadius: MENU_BUTTON_SIZE / 2,
            alignItems: "center",
            justifyContent: "center",
          },
          visualStyle,
        ]}
      >
        <LinearGradient
          colors={gradientColors}
          start={gradientStart}
          end={gradientEnd}
          style={{
            ...StyleSheet.absoluteFillObject,
            borderRadius: MENU_BUTTON_SIZE / 2,
          }}
        />
        <Animated.View
          style={[StyleSheet.absoluteFillObject, centered, listStyle]}
        >
          <List color={iconColor} size={22} weight="bold" />
        </Animated.View>
        <Animated.View
          style={[StyleSheet.absoluteFillObject, centered, closeStyle]}
        >
          <X color={iconColor} size={20} weight="bold" />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const centered = {
  alignItems: "center",
  justifyContent: "center",
} as const;
