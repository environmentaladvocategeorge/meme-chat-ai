import { AppPressable } from "@/components/AppPressable";
import { IconButton } from "@/components/IconButton";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import {
  Camera as CameraIcon,
  Gif as GifIcon,
  Keyboard as KeyboardIcon,
  Sticker,
} from "phosphor-react-native";
import type { ReactNode } from "react";

// The accessory buttons that sit just under the composer (photo · GIFs ·
// memes · rot level). They share one quiet, conversational pill language —
// rounded "lozenge" chips that read like chat affordances, not a toolbar.
// Resting chips are a soft card surface with a hairline border and a brand-
// tinted glyph; an active toggle fills solid with the brand color. No
// gradients, glows, or tilted badges — the row should feel calm and native
// next to the keyboard, and the glyphs sit inline (no clipping badge box) so
// the rot-level emoji renders at full height.
const PILL_HEIGHT = 40;

// Shared chip body. Grows to share the row evenly when there's room, but won't
// shrink below its content — so when all four don't fit (narrow screens, long
// locales) the row scrolls instead of cropping a label. See the ScrollView in
// chat.tsx that hosts these.
function ComposerPill({
  leading,
  label,
  active = false,
  onPress,
  accessibilityLabel,
  expanded,
}: {
  leading: ReactNode;
  label: string;
  active?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  expanded?: boolean;
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
        flexGrow: 1,
        flexShrink: 0,
        flexBasis: "auto",
      }}
      style={{
        height: PILL_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        paddingHorizontal: 14,
        borderRadius: PILL_HEIGHT / 2,
        borderWidth: 1,
        borderColor: active ? "transparent" : theme["--color-border"],
        backgroundColor: active
          ? theme["--color-primary"]
          : theme["--color-card"],
      }}
    >
      {leading}
      <Typography
        variant="body-sm"
        weight="bold"
        numberOfLines={1}
        style={{
          color: active
            ? theme["--color-primary-foreground"]
            : theme["--color-foreground-secondary"],
          letterSpacing: 0.2,
        }}
      >
        {label}
      </Typography>
    </AppPressable>
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
      size={PILL_HEIGHT}
      hitSlop={{ top: 14, bottom: 14, left: 14, right: 4 }}
      surfaceStyle={{
        borderWidth: 1,
        borderColor: theme["--color-border"],
        backgroundColor: theme["--color-card"],
        opacity: busy ? 0.7 : 1,
      }}
    >
      <CameraIcon size={19} color={theme["--color-primary"]} weight="fill" />
    </IconButton>
  );
}

// GIF drawer toggle. When the drawer is open the chip fills solid and its
// label flips to "Keyboard", so the glyph becomes a keyboard to match.
export function GifToggleButton({
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
        open ? (
          <KeyboardIcon
            size={18}
            color={theme["--color-primary-foreground"]}
            weight="fill"
          />
        ) : (
          <GifIcon size={18} color={theme["--color-primary"]} weight="fill" />
        )
      }
    />
  );
}

// Meme strip toggle — same language as the GIF chip with a sticker glyph.
export function MemeToggleButton({
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
        open ? (
          <KeyboardIcon
            size={18}
            color={theme["--color-primary-foreground"]}
            weight="fill"
          />
        ) : (
          <Sticker size={18} color={theme["--color-primary"]} weight="fill" />
        )
      }
    />
  );
}

// Emoji shown on the Rot Level chip per tier — mirrors RotLevelSheet's set so
// the chip previews the vibe that's currently dialed in.
const ROT_EMOJI = ["🤓", "😤", "💀"];

// Rot Level chip — opens the rot-level sheet rather than toggling a drawer, so
// it never enters the filled "active" state. The emoji is the leading glyph,
// rendered inline with generous line height so it sits at full size without
// being clipped.
export function RotLevelButton({
  label,
  level,
  onPress,
}: {
  label: string;
  level: number;
  onPress: () => void;
}) {
  return (
    <ComposerPill
      label={label}
      onPress={onPress}
      accessibilityLabel={`${label}, ${level}`}
      leading={
        <Typography
          variant="body"
          style={{ fontSize: 16, lineHeight: 22 }}
          allowFontScaling={false}
        >
          {ROT_EMOJI[Math.min(Math.max(level, 1), 3) - 1]}
        </Typography>
      }
    />
  );
}
