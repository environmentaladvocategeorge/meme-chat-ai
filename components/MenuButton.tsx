// Visual menu button. Renders the gradient circle with the cross-fading
// List/X icons and the press-pulse + rotate animation. Lives inline inside
// AppHeader so it shares a row (and therefore vertical centering) with the
// title text. State comes from `useMenuStore` so the matching overlay
// (mounted once at the (app) layout level) stays in sync.

import { gradients } from "@/nativewind-theme";
import { useMenuStore } from "@/store/menu";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";
import { List, X } from "phosphor-react-native";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const MENU_BUTTON_SIZE = 46;
const TAP_SPRING = { damping: 14, stiffness: 220, mass: 0.8 } as const;

export function MenuButton() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const primaryGradient = gradients[colorScheme ?? "light"].primary;
  const open = useMenuStore((s) => s.open);
  const toggle = useMenuStore((s) => s.toggle);

  const progress = useSharedValue(0);
  const scale = useSharedValue(1);

  useEffect(() => {
    progress.value = withSpring(open ? 1 : 0, TAP_SPRING);
  }, [open, progress]);

  const onPress = () => {
    scale.value = withSequence(
      withTiming(0.86, { duration: 90, easing: Easing.out(Easing.quad) }),
      withSpring(1, TAP_SPRING),
    );
    toggle();
  };

  const buttonStyle = useAnimatedStyle(() => {
    const rotate = interpolate(progress.value, [0, 1], [0, 90]);
    return {
      transform: [{ scale: scale.value }, { rotate: `${rotate}deg` }],
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
    <AnimatedPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t(open ? "menu.close" : "menu.open")}
      accessibilityState={{ expanded: open }}
      hitSlop={8}
      style={[
        {
          width: MENU_BUTTON_SIZE,
          height: MENU_BUTTON_SIZE,
          borderRadius: MENU_BUTTON_SIZE / 2,
          alignItems: "center",
          justifyContent: "center",
        },
        buttonStyle,
      ]}
    >
      <LinearGradient
        colors={primaryGradient.colors}
        start={primaryGradient.start}
        end={primaryGradient.end}
        style={{
          ...StyleSheet.absoluteFillObject,
          borderRadius: MENU_BUTTON_SIZE / 2,
        }}
      />
      <Animated.View style={[StyleSheet.absoluteFillObject, centered, listStyle]}>
        <List color="#FFFFFF" size={22} weight="bold" />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFillObject, centered, closeStyle]}>
        <X color="#FFFFFF" size={20} weight="bold" />
      </Animated.View>
    </AnimatedPressable>
  );
}

const centered = {
  alignItems: "center",
  justifyContent: "center",
} as const;
