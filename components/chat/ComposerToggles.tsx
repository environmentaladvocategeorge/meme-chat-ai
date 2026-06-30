import { AppPressable } from "@/components/AppPressable";
import { GlassSurface } from "@/components/GlassSurface";
import { IconButton } from "@/components/IconButton";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import {
  Brain as BrainIcon,
  Camera as CameraIcon,
  Images as ImagesIcon,
  Keyboard as KeyboardIcon,
} from "phosphor-react-native";
import { useEffect, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

// The accessory buttons that sit just under the composer (photo · GIFs ·
// memes · rot level). They share one quiet, conversational pill language —
// rounded "lozenge" chips that read like chat affordances, not a toolbar.
// Resting chips are a soft card surface with a hairline border and a brand-
// tinted glyph; an active (drawer-open) toggle takes a tinted selection —
// `primary-subtle` wash with `primary` content — rather than a solid brand
// fill, so an open drawer doesn't leave a loud block of color parked under
// the composer. No gradients, glows, or tilted badges — the row should feel
// calm and native next to the keyboard, and the glyphs sit inline (no
// clipping badge box) so the rot-level emoji renders at full height.
//
// Height matches SEND_BUTTON_SIZE in ChatInput so the whole bottom cluster
// reads as one family; hitSlop keeps the effective target at 48pt.
// Exported for ComposerSkeleton, which mirrors this row's geometry.
export const COMPOSER_CHIP_HEIGHT = 36;
const GLYPH_SIZE = 18;

// Shared chip body. Sized to its content (not stretched to fill the row) so the
// compact Photo · Media · Rot cluster reads as tidy chat affordances rather than
// big slabs. When the chips don't fit (narrow screens / long locales) the row
// scrolls instead of cropping a label. See the ScrollView in chat.tsx.
function ComposerPill({
  leading,
  label,
  active = false,
  onPress,
  accessibilityLabel,
  expanded,
  trailing,
}: {
  leading: ReactNode;
  label: string;
  active?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  expanded?: boolean;
  // Rendered after the label — used by the rot-level chip's intensity meter.
  trailing?: ReactNode;
}) {
  const theme = useTheme();

  // The pill is wide, so a transform on the touch target wouldn't actually drop
  // taps here — but routing it through AppPressable keeps every pressable in the
  // app on one proven core (static target, scale on an inner pointerEvents="none"
  // view) instead of a bespoke style-function transform. Sizing/flex stay on the
  // hit target (containerStyle); the surface look scales on the inner view.
  return (
    <AppPressable
      onPress={onPress}
      haptic
      hitSlop={6}
      pressScale={0.04}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      containerStyle={{
        flexGrow: 0,
        flexShrink: 0,
        flexBasis: "auto",
      }}
      style={{
        height: COMPOSER_CHIP_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        paddingHorizontal: 12,
        borderRadius: COMPOSER_CHIP_HEIGHT / 2,
        // Surface (fill/border) lives on the glass layer below, not here, so
        // Liquid Glass can replace it where supported.
      }}
    >
      {/* Glass surface layer — scales with the pill (it's inside the
          AppPressable inner view) and sits behind the glyph + label. Active
          (drawer-open) chips take a primary-tinted glass / subtle wash; the
          content color flip to primary still happens below.
          Active content uses the primary token family (not tertiary) so
          user-customized accent colors — which override primary/-muted/
          -subtle but not tertiary — keep the selected chip coherent. */}
      <GlassSurface
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          { borderRadius: COMPOSER_CHIP_HEIGHT / 2 },
        ]}
        tintColor={active ? theme["--color-primary-subtle"] : undefined}
        fallbackStyle={{
          borderWidth: 1,
          borderColor: active
            ? theme["--color-primary-muted"]
            : theme["--color-border"],
          backgroundColor: active
            ? theme["--color-primary-subtle"]
            : theme["--color-card"],
        }}
      />
      {leading}
      <Typography
        variant="body-sm"
        weight="semibold"
        numberOfLines={1}
        style={{
          color: active
            ? theme["--color-primary"]
            : theme["--color-foreground-secondary"],
        }}
      >
        {label}
      </Typography>
      {trailing}
    </AppPressable>
  );
}

// Cross-fades between the closed and open glyphs instead of snapping —
// matches the opacity-layer language the send button and pickers already
// use. Both icons stay mounted in a fixed box so the swap never reflows
// the label next to it.
function CrossFadeGlyph({
  open,
  closedIcon,
  openIcon,
}: {
  open: boolean;
  closedIcon: ReactNode;
  openIcon: ReactNode;
}) {
  const progress = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, {
      duration: 150,
      easing: Easing.out(Easing.cubic),
    });
  }, [open, progress]);

  const closedStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
  }));
  const openStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  return (
    <View style={{ width: GLYPH_SIZE, height: GLYPH_SIZE }}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, closedStyle]}
      >
        {closedIcon}
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, openStyle]}
      >
        {openIcon}
      </Animated.View>
    </View>
  );
}

// Circular camera button — the only icon-only affordance in the row. Stays a
// fixed circle (doesn't grow) so the labeled chips get the flexible space.
export function PhotoButton({
  label,
  busy,
  onPress,
}: {
  label: string;
  busy: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  // Built on IconButton (the shared static-target + inner-feedback core). The
  // hitSlop trims its right edge so the cushion doesn't bleed into the GIF pill
  // packed next to it.
  return (
    <IconButton
      onPress={onPress}
      busy={busy}
      busyColor={theme["--color-foreground-muted"]}
      accessibilityLabel={label}
      size={COMPOSER_CHIP_HEIGHT}
      hitSlop={{ top: 14, bottom: 14, left: 14, right: 4 }}
      glass
      // Fill/border live on the glass layer's fallback; only the busy dim
      // stays on the inner surface so the whole button (glass included) dims.
      surfaceStyle={{ opacity: busy ? 0.7 : 1 }}
      fallbackStyle={{
        borderWidth: 1,
        borderColor: theme["--color-border"],
        backgroundColor: theme["--color-card"],
      }}
    >
      <CameraIcon
        size={GLYPH_SIZE}
        color={theme["--color-primary"]}
        weight="fill"
      />
    </IconButton>
  );
}

// Media drawer toggle — one chip for the tabbed GIFs · Memes · Stickers drawer.
// (Replaced the separate GIF + meme chips so a third sticker chip wouldn't
// overflow the row.) When the drawer is open the chip takes the tinted selection
// and its label flips to "Keyboard", so the glyph becomes a keyboard to match.
export function MediaToggleButton({
  label,
  open,
  onPress,
}: {
  label: string;
  open: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <ComposerPill
      label={label}
      active={open}
      expanded={open}
      onPress={onPress}
      accessibilityLabel={label}
      leading={
        <CrossFadeGlyph
          open={open}
          closedIcon={
            <ImagesIcon
              size={GLYPH_SIZE}
              color={theme["--color-primary"]}
              weight="fill"
            />
          }
          openIcon={
            <KeyboardIcon
              size={GLYPH_SIZE}
              color={theme["--color-primary"]}
              weight="fill"
            />
          }
        />
      }
    />
  );
}

// Big Brain chip — a plain on/off toggle for the reply-model upgrade. It takes
// the same tinted "active" selection as the media chip when on (the brain glyph
// + label flip to primary), so "on" always reads as a lit chip. Distinct from
// the rot chip (which opens a sheet); this just flips state in place.
export function BigBrainToggleButton({
  label,
  on,
  onPress,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <ComposerPill
      label={label}
      active={on}
      onPress={onPress}
      accessibilityLabel={label}
      leading={
        <BrainIcon
          size={GLYPH_SIZE}
          color={theme["--color-primary"]}
          weight="fill"
        />
      }
    />
  );
}

// Emoji shown on the Rot Level chip per tier — mirrors RotLevelSheet's set so
// the chip previews the vibe that's currently dialed in.
const ROT_EMOJI = ["🤓", "😤", "💀"];

// Tiny ascending intensity meter — three solid bars, filled to the current
// tier in the brand color. What makes the rot chip read as "a dial with a
// value" next to its toggle neighbors, without introducing a second hue or
// translucent washes. Solid tokens only: filled bars are primary, unfilled
// bars are the strong border gray.
function RotMeter({ tier }: { tier: number }) {
  const theme = useTheme();
  return (
    <View
      style={{ flexDirection: "row", alignItems: "flex-end", gap: 2 }}
      pointerEvents="none"
    >
      {[6, 9, 12].map((height, i) => (
        <View
          key={height}
          style={{
            width: 3,
            height,
            borderRadius: 1.5,
            backgroundColor:
              i < tier
                ? theme["--color-primary"]
                : theme["--color-border-strong"],
          }}
        />
      ))}
    </View>
  );
}

// Rot Level chip — opens the rot-level sheet rather than toggling a drawer, so
// it never enters the selected "active" state. The emoji is the leading glyph,
// rendered inline with generous line height so it sits at full size without
// being clipped; the trailing meter previews how far the dial is turned. The
// emoji + meter pair is what differentiates this chip as a setting — the
// surface itself stays identical to its neighbors.
export function RotLevelButton({
  label,
  level,
  onPress,
}: {
  label: string;
  level: number;
  onPress: () => void;
}) {
  const tier = Math.min(Math.max(level, 1), 3);

  return (
    <ComposerPill
      label={label}
      onPress={onPress}
      accessibilityLabel={`${label}, ${level}`}
      trailing={<RotMeter tier={tier} />}
      leading={
        <Typography
          variant="body"
          style={{ fontSize: 16, lineHeight: 22 }}
          allowFontScaling={false}
        >
          {ROT_EMOJI[tier - 1]}
        </Typography>
      }
    />
  );
}
