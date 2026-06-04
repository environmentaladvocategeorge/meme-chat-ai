// MessageActions
//
// The action row under a finished agent reply: Copy, Thumbs up, Thumbs down.
// The row springs in when it mounts (i.e. when the reply finishes streaming).
// Thumbs are a bound, mutually-exclusive pair and give a playful bounce on tap;
// Copy gives a gentler pulse and briefly swaps to a check to confirm.

import { AppPressable } from "@/components/AppPressable";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import * as Clipboard from "expo-clipboard";
import {
  ArrowClockwise,
  Check,
  Copy,
  Smiley,
  ThumbsDown,
  ThumbsUp,
  type IconProps,
} from "phosphor-react-native";
import {
  type ComponentType,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type MessageReaction = "up" | "down";

const ICON = 18;

// The emoji-reaction picker set. MUST stay in sync with the backend allowlist
// MESSAGE_EMOJI_REACTIONS in functions/src/conversations/rateMessage.ts — the
// callable rejects anything outside it.
const EMOJI_REACTIONS = ["😂", "💀", "🔥", "😭", "🫡", "🤔", "🥀", "✨"] as const;

// Popover geometry. Kept as constants so the on-screen clamp below can compute
// the picker's real width without measuring it — the chips are all fixed-size.
const CHIP_SIZE = 34;
const CHIP_GAP = 2;
const POPOVER_PAD_H = 8;
const POPOVER_BORDER = 1;
const POPOVER_PAD_V = 6;
const POPOVER_WIDTH =
  EMOJI_REACTIONS.length * CHIP_SIZE +
  (EMOJI_REACTIONS.length - 1) * CHIP_GAP +
  POPOVER_PAD_H * 2 +
  POPOVER_BORDER * 2;
const POPOVER_HEIGHT = CHIP_SIZE + POPOVER_PAD_V * 2 + POPOVER_BORDER * 2;
// Gap the picker leaves between itself and the button it springs from.
const POPOVER_GAP = 10;
// Min gap the picker keeps from either screen edge when it has to slide to stay
// on-screen (e.g. the button sits near a corner).
const SCREEN_EDGE_PAD = 8;

// The measured trigger frame in window coordinates — the picker is positioned
// against this inside a top-level Modal so it can never be clipped by the list.
type Anchor = { x: number; y: number; width: number; height: number };

type EmojiColors = {
  card: string;
  border: string;
  foreground: string;
  activeBg: string;
};

// One emoji in the popover. Deliberately static (no reanimated): the picker is
// rendered in an RN Modal, where shared-value-driven styles don't reliably
// update — a progress-tied opacity there left the whole picker invisible. The
// Modal's native fade covers the appear/disappear; AppPressable still gives a
// press flinch (its rest state is visible regardless).
function EmojiChip({
  emoji,
  active,
  activeBg,
  onPress,
}: {
  emoji: string;
  active: boolean;
  activeBg: string;
  onPress: () => void;
}) {
  return (
    <AppPressable
      onPress={onPress}
      hitSlop={4}
      accessibilityLabel={emoji}
      containerStyle={{ borderRadius: CHIP_SIZE / 2 }}
      style={{
        width: CHIP_SIZE,
        height: CHIP_SIZE,
        borderRadius: CHIP_SIZE / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active ? activeBg : "transparent",
      }}
    >
      <Text style={{ fontSize: 21 }}>{emoji}</Text>
    </AppPressable>
  );
}

// The popover of emoji chips, rendered into the root Portal host so it floats
// above the chat list and a full-screen backdrop catches an outside tap to
// dismiss. The fixed-width picker is centered over the measured button and
// clamped to the screen edges (positioned by the parent, which has the screen +
// safe-area metrics), opening upward when there's room, below otherwise.
function EmojiPopover({
  top,
  left,
  selected,
  onPick,
  onDismiss,
  colors,
  dismissLabel,
}: {
  top: number;
  left: number;
  selected?: string;
  onPick: (emoji: string) => void;
  onDismiss: () => void;
  colors: EmojiColors;
  dismissLabel: string;
}) {
  return (
    // Full-screen catcher: any tap that isn't on a chip dismisses the picker.
    <Pressable
      onPress={onDismiss}
      accessibilityLabel={dismissLabel}
      style={StyleSheet.absoluteFill}
    >
      <View
        // Keep taps inside the picker (incl. the padding gaps) from bubbling to
        // the backdrop; the chips below claim their own taps to select.
        onStartShouldSetResponder={() => true}
        style={{
          position: "absolute",
          top,
          left,
          width: POPOVER_WIDTH,
          flexDirection: "row",
          alignItems: "center",
          gap: CHIP_GAP,
          paddingHorizontal: POPOVER_PAD_H,
          paddingVertical: POPOVER_PAD_V,
          borderRadius: 24,
          backgroundColor: colors.card,
          borderWidth: POPOVER_BORDER,
          borderColor: colors.border,
          shadowColor: colors.foreground,
          shadowOpacity: 0.12,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 8,
        }}
      >
        {EMOJI_REACTIONS.map((emoji) => (
          <EmojiChip
            key={emoji}
            emoji={emoji}
            active={emoji === selected}
            activeBg={colors.activeBg}
            onPress={() => onPick(emoji)}
          />
        ))}
      </View>
    </Pressable>
  );
}

// The action-row emoji button. Idle state is a Smiley ICON (never a literal
// emoji); once a reaction is picked the glyph cross-fades + scales into that
// emoji (same two-layer trick as ThumbIcon, since neither glyph can tween its
// own contents). Tapping opens/closes the picker.
function EmojiReactionButton({
  selected,
  onSelect,
  label,
  idleColor,
  colors,
}: {
  selected?: string;
  onSelect: (emoji: string) => void;
  label: string;
  idleColor: string;
  colors: EmojiColors;
}) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  // Measure the button in window coordinates so the picker (rendered in a
  // top-level Modal) can anchor to it, then compute the on-screen position here
  // — in the normal tree, where the screen + safe-area metrics are available
  // (the Modal's subtree is not under our SafeAreaProvider).
  const wrapperRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const measureAnchor = () => {
    wrapperRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
    });
  };

  const popoverLeft = anchor
    ? Math.max(
        SCREEN_EDGE_PAD,
        Math.min(
          anchor.x + anchor.width / 2 - POPOVER_WIDTH / 2,
          screenWidth - SCREEN_EDGE_PAD - POPOVER_WIDTH,
        ),
      )
    : 0;
  const openUpward =
    !!anchor && anchor.y - insets.top - POPOVER_GAP - POPOVER_HEIGHT > 0;
  const popoverTop = !anchor
    ? 0
    : openUpward
      ? anchor.y - POPOVER_GAP - POPOVER_HEIGHT
      : anchor.y + anchor.height + POPOVER_GAP;

  // Keep showing the last chosen emoji while it fades out on clear.
  const [displayEmoji, setDisplayEmoji] = useState(selected);
  useEffect(() => {
    if (selected) setDisplayEmoji(selected);
  }, [selected]);

  const has = Boolean(selected);
  const morph = useSharedValue(has ? 1 : 0);
  useEffect(() => {
    morph.value = withSpring(has ? 1 : 0, {
      damping: 12,
      stiffness: 220,
      mass: 0.7,
    });
  }, [has, morph]);
  // Match ThumbIcon: cross-fade OPACITY only on the phosphor SVG layer. A scale
  // transform on an SVG icon mis-sizes/distorts it on the first paint and then
  // snaps — so the idle icon gets no transform at all. The "pop" lives only on
  // the emoji layer below, which is a <Text> (scales cleanly, no SVG quirk).
  const iconStyle = useAnimatedStyle(() => ({ opacity: 1 - morph.value }));
  const emojiStyle = useAnimatedStyle(() => ({
    opacity: morph.value,
    transform: [{ scale: 0.85 + 0.15 * morph.value }],
  }));

  const layer = [
    StyleSheet.absoluteFillObject,
    { alignItems: "center", justifyContent: "center" },
  ] as const;

  return (
    <View ref={wrapperRef} collapsable={false}>
      <AppPressable
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={() =>
          setOpen((o) => {
            // Measure the trigger before the picker mounts on this open.
            if (!o) measureAnchor();
            return !o;
          })
        }
        haptic
        hitSlop={8}
        pressScale={0.12}
        style={{ paddingHorizontal: 6, paddingVertical: 4 }}
      >
        <View style={{ width: ICON, height: ICON }}>
          <Animated.View style={[layer, iconStyle]} pointerEvents="none">
            <Smiley size={ICON} color={idleColor} weight="regular" />
          </Animated.View>
          <Animated.View style={[layer, emojiStyle]} pointerEvents="none">
            {/* No fixed width: an intrinsic-width <Text> measures to the glyph's
                full advance (bearings included), so it never clips, and the
                parent layer's flex centering then aligns it exactly like the
                18px phosphor icons. A fixed, oversized frame instead left the
                emoji's asymmetric side-bearing sitting right-of-center. lineHeight
                is pinned to the icon box (and font padding stripped on Android)
                so it shares the same optical baseline as the other actions. */}
            <Text
              allowFontScaling={false}
              style={{
                fontSize: ICON - 4,
                lineHeight: ICON,
                textAlign: "center",
                includeFontPadding: false,
              }}
            >
              {displayEmoji ?? ""}
            </Text>
          </Animated.View>
        </View>
      </AppPressable>

      {/* The picker floats above the chat list in a top-level Modal (the proven
          Dropdown pattern) so it can't be clipped, and a full-screen backdrop
          dismisses it on an outside tap. Modal content sits outside the app's
          GestureHandlerRootView, so it gets its own for AppPressable to work. */}
      <Modal
        visible={open && !!anchor}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <GestureHandlerRootView style={{ flex: 1 }}>
          {anchor ? (
            <EmojiPopover
              top={popoverTop}
              left={popoverLeft}
              selected={selected}
              colors={colors}
              dismissLabel={label}
              onDismiss={() => setOpen(false)}
              onPick={(emoji) => {
                onSelect(emoji);
                setOpen(false);
              }}
            />
          ) : null}
        </GestureHandlerRootView>
      </Modal>
    </View>
  );
}

// A tappable icon that pops on press. `intensity` controls how punchy the pop
// is — "playful" for the thumbs, "soft" for copy. The pop is a quick timing-up
// followed by a tight spring back: a low-damping spring on the way *up* would
// oscillate around its peak and stall there (withSequence waits for it to
// settle), which read as the icon growing, getting stuck big, then shrinking.
function ActionButton({
  accessibilityLabel,
  onPress,
  intensity,
  children,
}: {
  accessibilityLabel: string;
  onPress: () => void;
  intensity: "playful" | "soft";
  children: ReactNode;
}) {
  // Small icon target: the press feedback lives on AppPressable's inner
  // pointerEvents="none" surface, never on the touch box. "playful" presses a
  // little deeper than "soft".
  return (
    <AppPressable
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      haptic
      hitSlop={8}
      pressScale={intensity === "playful" ? 0.14 : 0.1}
      style={{ paddingHorizontal: 6, paddingVertical: 4 }}
    >
      {children}
    </AppPressable>
  );
}

// A thumb glyph that smoothly cross-fades between its idle (outline, muted) and
// selected (filled, brand) states when the rating toggles — phosphor icons
// can't animate their `color`/`weight`, so we stack both and fade opacity.
function ThumbIcon({
  Icon,
  selected,
  idleColor,
  activeColor,
}: {
  Icon: ComponentType<IconProps>;
  selected: boolean;
  idleColor: string;
  activeColor: string;
}) {
  const progress = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(selected ? 1 : 0, {
      duration: 200,
      easing: Easing.out(Easing.cubic),
    });
  }, [selected, progress]);

  const idleStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  const activeStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  const layer = [
    StyleSheet.absoluteFillObject,
    { alignItems: "center", justifyContent: "center" },
  ] as const;

  return (
    <View style={{ width: ICON, height: ICON }}>
      <Animated.View style={[layer, idleStyle]} pointerEvents="none">
        <Icon size={ICON} color={idleColor} weight="regular" />
      </Animated.View>
      <Animated.View style={[layer, activeStyle]} pointerEvents="none">
        <Icon size={ICON} color={activeColor} weight="fill" />
      </Animated.View>
    </View>
  );
}

// The regenerate button. Spins a full turn on each tap for a little delight,
// and reuses the same press-pop feedback as the other actions.
function ReplayButton({
  accessibilityLabel,
  onPress,
  color,
}: {
  accessibilityLabel: string;
  onPress: () => void;
  color: string;
}) {
  const rotation = useSharedValue(0);
  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const handlePress = () => {
    rotation.value = withTiming(rotation.value + 360, {
      duration: 520,
      easing: Easing.out(Easing.cubic),
    });
    onPress();
  };

  return (
    <AppPressable
      accessibilityLabel={accessibilityLabel}
      onPress={handlePress}
      haptic
      hitSlop={8}
      pressScale={0.12}
      style={{ paddingHorizontal: 6, paddingVertical: 4 }}
    >
      <Animated.View style={spinStyle} pointerEvents="none">
        <ArrowClockwise size={ICON} color={color} weight="regular" />
      </Animated.View>
    </AppPressable>
  );
}

export function MessageActions({
  text,
  reaction,
  onRate,
  emojiReaction,
  onEmoji,
  onReplay,
  labels,
  timestamp,
  showTimestamp = false,
}: {
  text: string;
  reaction?: MessageReaction;
  onRate: (reaction: MessageReaction) => void;
  // The current emoji reaction on this message (persisted), if any.
  emojiReaction?: string;
  // Set/toggle the emoji reaction. Tapping the active emoji clears it.
  onEmoji: (emoji: string) => void;
  // Regenerate this reply. Passed only for the conversation's latest agent turn
  // (replaying an older one would orphan everything after it), so the button is
  // absent everywhere else.
  onReplay?: () => void;
  labels: {
    copy: string;
    copied: string;
    up: string;
    down: string;
    replay: string;
    react: string;
  };
  // When the bubble is tapped, its timestamp rides the right edge of this row.
  timestamp?: string | null;
  showTimestamp?: boolean;
}) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Spring the whole row in on mount — fires exactly when the reply finishes
  // (the row only renders once the message is finalized). The entrance is a
  // slide-up + fade, NOT a scale: scaling the row rasterizes and visibly
  // distorts the phosphor SVG icons (and the emoji) until it settles — the same
  // SVG-scale quirk called out on ThumbIcon. A translate is distortion-free.
  const enterTranslateY = useSharedValue(8);
  const enterOpacity = useSharedValue(0);
  useEffect(() => {
    enterOpacity.value = withTiming(1, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
    enterTranslateY.value = withSpring(0, {
      damping: 14,
      stiffness: 220,
      mass: 0.7,
    });
  }, [enterOpacity, enterTranslateY]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enterOpacity.value,
    transform: [{ translateY: enterTranslateY.value }],
  }));

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(text);
    } catch {
      // Best-effort: if the clipboard write fails we just skip the confirm.
      return;
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1200);
  };

  const idle = theme["--color-foreground-muted"];
  const active = theme["--color-primary"];
  const ok = theme["--color-success"];

  return (
    <Animated.View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 2,
          marginTop: 2,
          marginLeft: -6, // pull the row's optical edge back under the bubble
          // Span the bubble width so the timestamp can sit on its right edge.
          alignSelf: "stretch",
        },
        enterStyle,
      ]}
    >
      <ActionButton
        accessibilityLabel={copied ? labels.copied : labels.copy}
        onPress={handleCopy}
        intensity="soft"
      >
        {copied ? (
          <Check size={ICON} color={ok} weight="bold" />
        ) : (
          <Copy size={ICON} color={idle} weight="regular" />
        )}
      </ActionButton>

      <ActionButton
        accessibilityLabel={labels.up}
        onPress={() => onRate("up")}
        intensity="playful"
      >
        <ThumbIcon
          Icon={ThumbsUp}
          selected={reaction === "up"}
          idleColor={idle}
          activeColor={active}
        />
      </ActionButton>

      <ActionButton
        accessibilityLabel={labels.down}
        onPress={() => onRate("down")}
        intensity="playful"
      >
        <ThumbIcon
          Icon={ThumbsDown}
          selected={reaction === "down"}
          idleColor={idle}
          activeColor={active}
        />
      </ActionButton>

      {onReplay ? (
        <ReplayButton
          accessibilityLabel={labels.replay}
          onPress={onReplay}
          color={idle}
        />
      ) : null}

      <EmojiReactionButton
        selected={emojiReaction}
        onSelect={onEmoji}
        label={labels.react}
        idleColor={idle}
        colors={{
          card: theme["--color-card"],
          border: theme["--color-border"],
          foreground: theme["--color-foreground"],
          activeBg: theme["--color-primary-subtle"],
        }}
      />

      {showTimestamp && timestamp ? (
        // Fades in on tap and floats to the bubble's right edge, sharing the
        // baseline with the action icons.
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(160)}
          style={{ marginLeft: "auto", paddingLeft: 8 }}
        >
          <Typography variant="micro" style={{ color: idle }}>
            {timestamp}
          </Typography>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
