import { MemeAvatar } from "@/components/MemeAvatar";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { CheckCircle } from "phosphor-react-native";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

const STEP_MS = 750;
const ENTER_DURATION = 300;
const ENTER_OFFSET = 12; // px — subtle push, stays fully in bounds

function SpinnerIcon({ color }: { color: string }) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(withTiming(360, { duration: 1000 }), -1, false);
  }, [rotation]);

  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View
      style={[
        style,
        {
          width: 20,
          height: 20,
          borderRadius: 10,
          borderWidth: 2.5,
          borderColor: color,
          borderTopColor: "transparent",
        },
      ]}
    />
  );
}

function CheckIcon({ color }: { color: string }) {
  const scale = useSharedValue(0.7);
  const opacity = useSharedValue(0);

  useEffect(() => {
    scale.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
    opacity.value = withTiming(1, { duration: 180 });
  }, [scale, opacity]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={style}>
      <CheckCircle size={20} color={color} weight="fill" />
    </Animated.View>
  );
}

// Each row fades in with a gentle push from alternating sides.
function LoadingRow({
  line,
  isDone,
  isActive,
  fromLeft,
  theme,
}: {
  line: string;
  isDone: boolean;
  isActive: boolean;
  fromLeft: boolean;
  theme: ReturnType<typeof useTheme>;
}) {
  const translateX = useSharedValue(fromLeft ? -ENTER_OFFSET : ENTER_OFFSET);
  const opacity = useSharedValue(0);

  useEffect(() => {
    translateX.value = withTiming(0, {
      duration: ENTER_DURATION,
      easing: Easing.out(Easing.cubic),
    });
    opacity.value = withTiming(1, { duration: ENTER_DURATION });
  }, [translateX, opacity]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        animStyle,
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingVertical: 13,
          paddingHorizontal: 14,
          borderRadius: 14,
          backgroundColor: theme["--color-card"],
          borderWidth: 1,
          borderColor: isDone
            ? theme["--color-primary-muted"]
            : theme["--color-border"],
        },
      ]}
    >
      {isDone ? (
        <CheckIcon color={theme["--color-primary"]} />
      ) : (
        <SpinnerIcon color={theme["--color-foreground-muted"]} />
      )}
      <Typography
        variant="body"
        style={{
          color: isDone
            ? theme["--color-primary"]
            : isActive
              ? theme["--color-foreground"]
              : theme["--color-foreground-muted"],
          flex: 1,
          fontWeight: isDone ? "600" : "400",
        }}
      >
        {line}
      </Typography>
    </Animated.View>
  );
}

function RevealBullet({
  bullet,
  index,
  theme,
}: {
  bullet: string;
  index: number;
  theme: ReturnType<typeof useTheme>;
}) {
  const fromLeft = index % 2 === 0;
  const translateX = useSharedValue(fromLeft ? -ENTER_OFFSET : ENTER_OFFSET);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const delay = index * 70;
    translateX.value = withTiming(0, {
      duration: ENTER_DURATION,
      easing: Easing.out(Easing.cubic),
    });
    opacity.value = withTiming(1, { duration: ENTER_DURATION + delay });
  }, [translateX, opacity, index]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        animStyle,
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingVertical: 11,
          paddingHorizontal: 14,
          borderRadius: 14,
          backgroundColor: theme["--color-card"],
          borderWidth: 1,
          borderColor: theme["--color-primary-muted"],
        },
      ]}
    >
      <CheckCircle size={20} color={theme["--color-primary"]} weight="fill" />
      <Typography variant="body" style={{ color: theme["--color-foreground"] }}>
        {bullet}
      </Typography>
    </Animated.View>
  );
}

export function AgentReadyReveal({
  onReadyChange,
}: {
  // Reports the gate state to the parent CTA: `false` while the fake "setting
  // up" sequence is still running, `true` once the reveal ("Brainrot Bot has
  // entered the chat") lands. Fired on mount too, so the CTA is forced disabled
  // even if the parent is re-using stale state from a previous visit/reload.
  onReadyChange?: (ready: boolean) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const loading = t("onboarding.ready.loading", { returnObjects: true });
  const lines = Array.isArray(loading) ? (loading as string[]) : [];
  const bullets = t("onboarding.ready.bullets", { returnObjects: true });
  const bulletList = Array.isArray(bullets) ? (bullets as string[]) : [];

  const [progress, setProgress] = useState(0);
  const revealed = progress > lines.length;
  const completedRef = useRef(false);

  // Reveal fade
  const revealOpacity = useSharedValue(0);
  const revealStyle = useAnimatedStyle(() => ({ opacity: revealOpacity.value }));

  useEffect(() => {
    if (lines.length === 0) {
      setProgress(1);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= lines.length + 1; i += 1) {
      timers.push(setTimeout(() => setProgress(i), STEP_MS * i));
    }
    return () => timers.forEach(clearTimeout);
  }, [lines.length]);

  // Force the gate closed the moment this mounts (fresh entry or a replay after
  // navigating back), so the CTA can never be live while the animation runs.
  useEffect(() => {
    onReadyChange?.(false);
  }, [onReadyChange]);

  useEffect(() => {
    if (revealed && !completedRef.current) {
      completedRef.current = true;
      revealOpacity.value = withTiming(1, { duration: 260 });
      onReadyChange?.(true);
    }
  }, [revealed, onReadyChange, revealOpacity]);

  if (revealed) {
    return (
      <Animated.View style={[revealStyle, { alignItems: "center", gap: 16 }]}>
        <MemeAvatar variant="cool" size={96} pulse />
        <View style={{ alignItems: "center", gap: 6 }}>
          <Typography
            family="display"
            weight="bold"
            style={{
              color: theme["--color-foreground"],
              fontSize: 24,
              lineHeight: 30,
              textAlign: "center",
            }}
          >
            {t("onboarding.ready.title")}
          </Typography>
          <Typography
            variant="body"
            style={{
              color: theme["--color-foreground-secondary"],
              textAlign: "center",
            }}
          >
            {t("onboarding.ready.subtitle")}
          </Typography>
        </View>
        <View style={{ width: "100%", gap: 8, marginTop: 4 }}>
          {bulletList.map((b, i) => (
            <RevealBullet key={b} bullet={b} index={i} theme={theme} />
          ))}
        </View>
      </Animated.View>
    );
  }

  return (
    <View style={{ gap: 10, paddingTop: 8 }}>
      {lines.map((line, i) => {
        if (i > progress) return null;
        return (
          <LoadingRow
            key={line}
            line={line}
            isDone={i < progress}
            isActive={i === progress}
            fromLeft={i % 2 === 0}
            theme={theme}
          />
        );
      })}
    </View>
  );
}
