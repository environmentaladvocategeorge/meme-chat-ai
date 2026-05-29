// MessageActions
//
// The action row under a finished agent reply: Copy, Thumbs up, Thumbs down.
// The row springs in when it mounts (i.e. when the reply finishes streaming).
// Thumbs are a bound, mutually-exclusive pair and give a playful bounce on tap;
// Copy gives a gentler pulse and briefly swaps to a check to confirm.

import { useTheme } from "@/hooks/useTheme";
import * as Clipboard from "expo-clipboard";
import { Check, Copy, ThumbsDown, ThumbsUp, type IconProps } from "phosphor-react-native";
import {
  type ComponentType,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

export type MessageReaction = "up" | "down";

const ICON = 18;

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
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePress = () => {
    const peak = intensity === "playful" ? 1.18 : 1.1;
    scale.value = withSequence(
      withTiming(peak, { duration: 110, easing: Easing.out(Easing.quad) }),
      withSpring(1, { damping: 13, stiffness: 320, mass: 0.5 }),
    );
    onPress();
  };

  return (
    <Animated.View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={handlePress}
        hitSlop={8}
        style={{ paddingHorizontal: 6, paddingVertical: 4 }}
      >
        {children}
      </Pressable>
    </Animated.View>
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

export function MessageActions({
  text,
  reaction,
  onRate,
  labels,
}: {
  text: string;
  reaction?: MessageReaction;
  onRate: (reaction: MessageReaction) => void;
  labels: { copy: string; copied: string; up: string; down: string };
}) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Spring the whole row in on mount — fires exactly when the reply finishes
  // (the row only renders once the message is finalized).
  const enterScale = useSharedValue(0.85);
  const enterOpacity = useSharedValue(0);
  useEffect(() => {
    enterOpacity.value = withTiming(1, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
    enterScale.value = withSpring(1, { damping: 11, stiffness: 220, mass: 0.7 });
  }, [enterOpacity, enterScale]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enterOpacity.value,
    transform: [{ scale: enterScale.value }],
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
    </Animated.View>
  );
}
