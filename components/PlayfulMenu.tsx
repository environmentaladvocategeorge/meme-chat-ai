// PlayfulMenu (overlay)
//
// Renders the dimmed backdrop + spring-animated navigation pills that
// appear when the menu is open. State comes from `useMenuStore`; the
// matching MenuButton lives inline inside AppHeader so the two stay
// in sync without a parent/child relationship.

import { MENU_BUTTON_SIZE } from "@/components/MenuButton";
import { MAX_CONTENT_WIDTH } from "@/components/MaxWidthFrame";
import { Typography } from "@/components/Typography";
import { gradients, themes } from "@/nativewind-theme";
import { useMenuStore } from "@/store/menu";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useSegments } from "expo-router";
import { useColorScheme } from "nativewind";
import {
  ChatCircleDots,
  ClockCounterClockwise,
  Gear,
  type IconProps,
} from "phosphor-react-native";
import { ComponentType, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const ITEM_HEIGHT = 56;
const ITEM_GAP = 12;
const OPEN_SPRING = { damping: 12, stiffness: 180, mass: 0.9 } as const;

type RouteKey = "chat" | "history" | "settings";

type MenuItemDef = {
  key: RouteKey;
  path: "/chat" | "/history" | "/settings";
  labelKey: string;
  Icon: ComponentType<IconProps>;
};

const ITEMS: readonly MenuItemDef[] = [
  { key: "chat", path: "/chat", labelKey: "menu.chat", Icon: ChatCircleDots },
  {
    key: "history",
    path: "/history",
    labelKey: "menu.history",
    Icon: ClockCounterClockwise,
  },
  { key: "settings", path: "/settings", labelKey: "menu.settings", Icon: Gear },
] as const;

export function PlayfulMenu() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = themes[colorScheme ?? "light"];
  const primaryGradient = gradients[colorScheme ?? "light"].primary;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  const open = useMenuStore((s) => s.open);
  const close = useMenuStore((s) => s.close);
  // `mounted` keeps the overlay in the tree just long enough to play the
  // exit animation before we unmount.
  const [mounted, setMounted] = useState(false);

  const progress = useSharedValue(0);

  const activeKey: RouteKey = useMemo(() => {
    const last = segments[segments.length - 1];
    if (last === "history") return "history";
    if (last === "settings") return "settings";
    return "chat";
  }, [segments]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      progress.value = withSpring(1, OPEN_SPRING);
    } else if (mounted) {
      progress.value = withTiming(
        0,
        { duration: 240, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(setMounted)(false);
        },
      );
    }
  }, [open, mounted, progress]);

  const handleNavigate = useCallback(
    (item: MenuItemDef) => {
      close();
      if (item.key !== activeKey) {
        router.replace(item.path);
      }
    },
    [activeKey, close, router],
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  if (!mounted) return null;

  return (
    <View
      pointerEvents={open ? "auto" : "none"}
      style={StyleSheet.absoluteFillObject}
    >
      <AnimatedPressable
        onPress={close}
        accessibilityLabel={t("menu.close")}
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: theme["--color-overlay"] },
          backdropStyle,
        ]}
      />

      {/* Full-screen centering layer so the backdrop can dim edge-to-edge while
          the pills stay confined to (and left-aligned within) the same content
          column as the header — keeping them under the menu button on iPad. */}
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          top: insets.top + MENU_BUTTON_SIZE + 22,
          left: 0,
          right: 0,
          alignItems: "center",
        }}
      >
        <View
          pointerEvents="box-none"
          style={{
            width: "100%",
            maxWidth: MAX_CONTENT_WIDTH,
            paddingHorizontal: 16,
            gap: ITEM_GAP,
          }}
        >
          {ITEMS.map((item, index) => (
            <MenuPill
              key={item.key}
              index={index}
              progress={progress}
              isActive={item.key === activeKey}
              label={t(item.labelKey)}
              Icon={item.Icon}
              onPress={() => handleNavigate(item)}
              theme={theme}
              gradient={primaryGradient}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

type Theme = (typeof themes)[keyof typeof themes];
type PrimaryGradient = (typeof gradients)[keyof typeof gradients]["primary"];

type MenuPillProps = {
  index: number;
  progress: SharedValue<number>;
  isActive: boolean;
  label: string;
  Icon: ComponentType<IconProps>;
  onPress: () => void;
  theme: Theme;
  gradient: PrimaryGradient;
};

function MenuPill({
  index,
  progress,
  isActive,
  label,
  Icon,
  onPress,
  theme,
  gradient,
}: MenuPillProps) {
  // Staggered entrance: each subsequent pill waits a bit longer before it
  // begins to spring in. Encoded as input ranges on the shared `progress`
  // value so reversing `progress` (close) replays the stagger in reverse.
  const delay = index * 0.18;
  const inMin = delay;
  const inMax = Math.min(1, delay + 0.55);

  const pillStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const raw = (p - inMin) / (inMax - inMin);
    const local = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    const translateX = interpolate(local, [0, 1], [-80, 0]);
    const rotate = interpolate(local, [0, 1], [-8, 0]);
    const scale = interpolate(local, [0, 1], [0.85, 1]);
    const opacity = interpolate(local, [0, 1], [0, 1]);
    return {
      opacity,
      transform: [
        { translateX },
        { rotate: `${rotate}deg` },
        { scale },
      ],
    };
  });

  return (
    <AnimatedPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: isActive }}
      style={[
        {
          height: ITEM_HEIGHT,
          borderRadius: ITEM_HEIGHT / 2,
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 10,
          paddingRight: 22,
          alignSelf: "flex-start",
          minWidth: 200,
          backgroundColor: isActive ? "transparent" : theme["--color-card"],
          borderWidth: isActive ? 0 : 1,
          borderColor: theme["--color-border"],
          shadowColor: theme["--color-foreground"],
          shadowOpacity: 0.08,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 3,
          overflow: "hidden",
        },
        pillStyle,
      ]}
    >
      {isActive && (
        <LinearGradient
          colors={gradient.colors}
          start={gradient.start}
          end={gradient.end}
          style={StyleSheet.absoluteFillObject}
        />
      )}
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: isActive
            ? "rgba(255,255,255,0.22)"
            : theme["--color-primary-subtle"],
          marginRight: 12,
        }}
      >
        <Icon
          color={isActive ? "#FFFFFF" : theme["--color-primary"]}
          size={20}
          weight="bold"
        />
      </View>
      <Typography
        variant="title-sm"
        style={{
          color: isActive ? "#FFFFFF" : theme["--color-foreground"],
        }}
      >
        {label}
      </Typography>
    </AnimatedPressable>
  );
}
