// PlayfulMenu (overlay)
//
// Renders the dimmed backdrop + spring-animated navigation pills that
// appear when the menu is open. State comes from `useMenuStore`; the
// matching MenuButton lives inline inside AppHeader so the two stay
// in sync without a parent/child relationship.

import { AppPressable } from "@/components/AppPressable";
import { GlassSurface } from "@/components/GlassSurface";
import { MENU_BUTTON_SIZE, MenuButton } from "@/components/MenuButton";
import { MAX_CONTENT_WIDTH } from "@/components/MaxWidthFrame";
import { Typography } from "@/components/Typography";
import { tapHaptic } from "@/lib/haptics";
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
import { StyleSheet, View } from "react-native";
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
      tapHaptic();
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
      {/* Static full-screen catcher; only the inner dimmer animates its
          opacity, so the touch frame never moves. */}
      <AppPressable
        onPress={close}
        feedback="none"
        hitSlop={0}
        accessibilityLabel={t("menu.close")}
        containerStyle={StyleSheet.absoluteFillObject}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: theme["--color-overlay"] },
            backdropStyle,
          ]}
        />
      </AppPressable>

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

      {/* The menu button, lifted ABOVE the dim so it stays bright and is the
          obvious "tap to close" target while the menu is open. The header's own
          button sits underneath the scrim in the exact same spot; this is the
          same component (shared menu store), so its X icon + tap stay in sync.
          Positioned to match the header: top = safe-area + TOP_GAP(4), aligned
          to the left of the same max-width content column (paddingHorizontal
          16) so it lines up on phone and iPad alike. */}
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          top: insets.top + 4,
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
          }}
        >
          <View style={{ alignSelf: "flex-start" }}>
            <MenuButton />
          </View>
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
    // NOTE: deliberately NO opacity — these pills are glass, and opacity 0 on a
    // glass view (or parent) permanently kills the native material (see
    // GlassSurface's opacity-0 note). The slide + scale + rotate carry the
    // staggered entrance instead; reversing `progress` still replays it.
    return {
      transform: [
        { translateX },
        { rotate: `${rotate}deg` },
        { scale },
      ],
    };
  });

  // The slide/scale/rotate animation lives on a pointerEvents="none" inner
  // view; the touch target stays a static box at the pill's resting position.
  // Animating the target itself desyncs Fabric's hit-test frame in release
  // builds, which makes the pill drop taps until a re-layout. feedback="none"
  // keeps AppPressable from adding its own scale layer — the entrance view is
  // the only animation here.
  return (
    <AppPressable
      onPress={onPress}
      feedback="none"
      accessibilityLabel={label}
      accessibilityState={{ selected: isActive }}
      containerStyle={{ alignSelf: "flex-start" }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          {
            height: ITEM_HEIGHT,
            borderRadius: ITEM_HEIGHT / 2,
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: 10,
            paddingRight: 22,
            minWidth: 200,
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
        {isActive ? (
          <LinearGradient
            colors={gradient.colors}
            start={gradient.start}
            end={gradient.end}
            style={StyleSheet.absoluteFillObject}
          />
        ) : (
          // Inactive pills float over the dimmed live backdrop → Liquid Glass
          // refracts it. The previous solid card + border is the fallback.
          <GlassSurface
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFillObject,
              { borderRadius: ITEM_HEIGHT / 2 },
            ]}
            fallbackStyle={{
              backgroundColor: theme["--color-card"],
              borderWidth: 1,
              borderColor: theme["--color-border"],
            }}
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
      </Animated.View>
    </AppPressable>
  );
}
