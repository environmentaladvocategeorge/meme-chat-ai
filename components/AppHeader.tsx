// AppHeader
//
// A floating, transparent header overlay that sits at the top of every screen
// in the (app) group. There is NO solid card: content scrolls UNDER the header
// and stays VISIBLE behind it — a translucent top scrim only lightly dims it
// (so the floating pills refract it on the glass path) rather than painting it
// out. The row holds the menu button (or a back arrow) on the left, a small
// glass title pill in the center, and an optional action on the right.
//
// Because the header is absolutely positioned, every screen that renders it
// must pad its scroll content by useAppHeaderHeight() so resting content starts
// below the row instead of hidden under it.

import { GlassSurface } from "@/components/GlassSurface";
import { IconButton } from "@/components/IconButton";
import { MENU_BUTTON_SIZE, MenuButton } from "@/components/MenuButton";
import { Typography } from "@/components/Typography";
import { withAlpha } from "@/domain/customization";
import { useTheme } from "@/hooks/useTheme";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowLeft, CaretRight } from "phosphor-react-native";
import { useCallback, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const TOP_GAP = 4;
const BOTTOM_GAP = 10;
// Header content height (excluding the safe-area inset). The avatar now sits
// INSIDE the title pill (single row), so the avatar layout is no longer taller
// than the bare title row — both are driven by the menu button's height. The
// "avatar" variant is kept so call sites don't change, but resolves the same.
// Screens add useAppHeaderHeight() as top padding to their scroll content.
const TITLE_CONTENT = TOP_GAP + MENU_BUTTON_SIZE + BOTTOM_GAP; // 60
const AVATAR_CONTENT = TITLE_CONTENT;
// The scrim dims behind the safe-area + row, then dissolves to fully clear
// over this extra distance so the dim ends just below the row.
const FADE_EXTRA = 28;

type HeaderVariant = "title" | "avatar";

// The vertical space the floating header occupies, including the safe-area
// inset. Screens use this to inset their scroll content (paddingTop +
// scrollIndicatorInsets). The chat screen passes "avatar".
export function useAppHeaderHeight(variant: HeaderVariant = "title"): number {
  const insets = useSafeAreaInsets();
  return insets.top + (variant === "avatar" ? AVATAR_CONTENT : TITLE_CONTENT);
}

interface AppHeaderProps {
  title: string;
  // When set, swaps the menu button on the left for a back arrow. Used on
  // detail screens (e.g. /plan) where the user needs to return to the
  // origin page rather than open the global menu.
  onBack?: () => void;
  backAccessibilityLabel?: string;
  // Optional element rendered in the right-hand slot (kept the same width as
  // the menu button so the center stays geometrically centered). Used by the
  // chat screen for its "new conversation" action.
  right?: ReactNode;
  // Optional element rendered INSIDE the title pill, to the LEFT of the title
  // (chat persona avatar). When present the pill becomes the interactive
  // persona pill (avatar + name + caret, with a tap-pop) instead of the static
  // title pill.
  avatar?: ReactNode;
  // Fired when the (interactive) persona pill is tapped. Optional — when unset
  // the pill still plays its tap feedback, it just performs no navigation yet.
  onTitlePress?: () => void;
  // The color the top darken fade dissolves into. Defaults to the screen
  // background; the chat screen passes its background-aware color so a custom
  // chat background doesn't show a wrong-colored band.
  fadeColor?: string;
}

export function AppHeader({
  title,
  onBack,
  backAccessibilityLabel,
  right,
  avatar,
  onTitlePress,
  fadeColor,
}: AppHeaderProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const variant: HeaderVariant = avatar ? "avatar" : "title";
  const headerHeight =
    insets.top + (variant === "avatar" ? AVATAR_CONTENT : TITLE_CONTENT);
  const fadeHeight = headerHeight + FADE_EXTRA;
  const resolvedFade = fadeColor ?? theme["--color-background"];

  const titlePill = (
    <GlassSurface
      pointerEvents="none"
      style={{
        height: 30,
        borderRadius: 16,
        paddingHorizontal: 14,
        alignItems: "center",
        justifyContent: "center",
        maxWidth: "100%",
      }}
      fallbackStyle={{
        backgroundColor: theme["--color-card"],
        borderWidth: 1,
        borderColor: theme["--color-border"],
      }}
    >
      <Typography
        variant="body"
        weight="semibold"
        numberOfLines={1}
        style={{ color: theme["--color-foreground"], fontSize: 15 }}
      >
        {title}
      </Typography>
    </GlassSurface>
  );

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 }}
    >
      {/* Top scrim: a TRANSLUCENT dim (never fully opaque) so scrolling content
          stays visible behind the floating pills — and refracts through them on
          the glass path — instead of being painted out. Heaviest at the very
          top for status-bar legibility, lightening through the row, gone below.
          Tune the two alphas on a real iOS 26 device if the dim reads too heavy
          (less) or the status bar gets hard to read over busy content (more). */}
      <LinearGradient
        pointerEvents="none"
        colors={[
          withAlpha(resolvedFade, 0.7),
          withAlpha(resolvedFade, 0.32),
          withAlpha(resolvedFade, 0),
        ]}
        locations={[0, headerHeight / fadeHeight, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: fadeHeight,
        }}
      />

      <View
        pointerEvents="box-none"
        style={{
          paddingTop: insets.top + TOP_GAP,
          paddingHorizontal: 16,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        {/* Left: menu or back. */}
        {onBack ? (
          <IconButton
            onPress={onBack}
            accessibilityLabel={backAccessibilityLabel ?? "Back"}
            size={MENU_BUTTON_SIZE}
            hitSlop={8}
            glass
            fallbackStyle={{ backgroundColor: theme["--color-card-muted"] }}
          >
            <ArrowLeft
              size={20}
              weight="bold"
              color={theme["--color-foreground"]}
            />
          </IconButton>
        ) : (
          <MenuButton />
        )}

        {/* Center: the interactive persona pill (avatar + name + caret) when an
            avatar is supplied, otherwise the static title pill. */}
        <View
          pointerEvents="box-none"
          style={{ flex: 1, alignItems: "center", paddingHorizontal: 8 }}
        >
          {avatar ? (
            <PersonaPill
              title={title}
              avatar={avatar}
              onPress={onTitlePress}
              theme={theme}
            />
          ) : (
            titlePill
          )}
        </View>

        {/* Right slot, matched to the menu-button width for symmetry. */}
        <View
          style={{
            width: MENU_BUTTON_SIZE,
            height: MENU_BUTTON_SIZE,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {right}
        </View>
      </View>
    </View>
  );
}

// The interactive persona pill: avatar + name + a trailing caret, all inside
// one glass pill. Carries the same tap feedback as the chat composer (a quick
// scale dip that springs back, plus a faint white brighten flash) so it reads
// as tappable even before an onPress action is wired up.
function PersonaPill({
  title,
  avatar,
  onPress,
  theme,
}: {
  title: string;
  avatar: ReactNode;
  onPress?: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  const pressScale = useSharedValue(1);
  const pressGlow = useSharedValue(0);

  const triggerPressFeedback = useCallback(() => {
    pressScale.value = withSequence(
      withTiming(0.96, { duration: 90, easing: Easing.out(Easing.quad) }),
      withSpring(1, { damping: 15, stiffness: 320, mass: 0.5 }),
    );
    pressGlow.value = withSequence(
      withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 280, easing: Easing.out(Easing.quad) }),
    );
  }, [pressScale, pressGlow]);

  const scaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: pressGlow.value * 0.12,
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={triggerPressFeedback}
      accessibilityRole="button"
      accessibilityLabel={title}
      hitSlop={8}
      style={{ maxWidth: "100%" }}
    >
      {/* Scale rides this pointerEvents="none" inner view, never the Pressable
          box, so the native hit frame never moves (Fabric release discipline). */}
      <Animated.View pointerEvents="none" style={scaleStyle}>
        <GlassSurface
          glassEffectStyle="regular"
          style={{
            height: 38,
            borderRadius: 19,
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
            paddingLeft: 6,
            paddingRight: 12,
            maxWidth: "100%",
            overflow: "hidden",
          }}
          fallbackStyle={{
            backgroundColor: theme["--color-card"],
            borderWidth: 1,
            borderColor: theme["--color-border"],
          }}
        >
          {/* Tap brighten flash — over the surface, under the content. */}
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFillObject,
              { backgroundColor: "#FFFFFF", borderRadius: 19 },
              glowStyle,
            ]}
          />
          {avatar}
          <Typography
            variant="body"
            weight="semibold"
            numberOfLines={1}
            style={{
              color: theme["--color-foreground"],
              flexShrink: 1,
              fontSize: 15,
            }}
          >
            {title}
          </Typography>
          <CaretRight
            size={16}
            weight="bold"
            color={theme["--color-foreground-muted"]}
          />
        </GlassSurface>
      </Animated.View>
    </Pressable>
  );
}
