import { AgentAvatar } from "@/components/AgentAvatar";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { gradients } from "@/nativewind-theme";
import { useOnboardingStore } from "@/store/onboarding";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

const STARTER_COUNT = 3;

// Fisher–Yates pick of n distinct items. Copies first so the source list
// isn't mutated.
function pickRandom<T>(items: T[], n: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

export function EmptyChatState({
  onStarterPress,
  atLimit,
}: {
  onStarterPress: (text: string) => void;
  atLimit: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const accentGradient = gradients[colorScheme ?? "light"].accent;

  // One-shot seeded first chat: the moment onboarding finishes, open with
  // Brainrot Bot's fixed welcome + the spec's prompt chips instead of a random intro,
  // so day one is never a blank composer. Captured once on mount (so a later
  // store update mid-session doesn't swap the copy out) and consumed so any
  // subsequent new chat reverts to the random pool.
  const consumeJustCompleted = useOnboardingStore((s) => s.consumeJustCompleted);
  const seedFirstChat = useRef(
    useOnboardingStore.getState().justCompleted && !atLimit,
  );
  useEffect(() => {
    if (seedFirstChat.current) consumeJustCompleted();
  }, [consumeJustCompleted]);

  // Randomize which starters appear each time the empty state mounts (new
  // conversation / fresh load), drawn from the full pool in the locale file.
  // Right after onboarding, use the fixed seeded chips instead.
  const starters = useMemo(() => {
    if (seedFirstChat.current) {
      const seeded = t("chat.firstChat.chips", { returnObjects: true });
      // The seeded pool can hold more than we want to show; only ever surface
      // STARTER_COUNT chips so the empty state stays tidy.
      if (Array.isArray(seeded)) {
        return (seeded as string[]).slice(0, STARTER_COUNT);
      }
    }
    const pool = t("chat.starters.items", { returnObjects: true });
    if (!Array.isArray(pool)) return [];
    return pickRandom(pool as string[], STARTER_COUNT);
  }, [t]);

  // Pick a fresh title/subtitle pair each mount. The at-limit state has its
  // own fixed copy; the normal state draws one of the playful intros at random
  // (or the seeded first-chat copy right after onboarding).
  const intro = useMemo<{ title: string; subtitle: string }>(() => {
    if (atLimit) {
      return {
        title: t("chat.empty.atTitle"),
        subtitle: t("chat.empty.atSubtitle"),
      };
    }
    if (seedFirstChat.current) {
      return {
        title: t("chat.firstChat.title"),
        subtitle: t("chat.firstChat.subtitle"),
      };
    }
    const pool = t("chat.empty.intros", { returnObjects: true });
    if (!Array.isArray(pool) || pool.length === 0) {
      return { title: "", subtitle: "" };
    }
    return pool[Math.floor(Math.random() * pool.length)] as {
      title: string;
      subtitle: string;
    };
  }, [t, atLimit]);

  // Entrance for the whole empty state. Plays once when this mounts — i.e. the
  // moment the loader clears and Brainrot Bot "wakes up". A soft opacity fade paired
  // with a gentle spring scale so it eases in instead of hard-blinking. The
  // animated transform lives on an inner view so it doesn't disturb the
  // outer scaleY:-1 counter-flip the inverted FlatList requires.
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.92);

  useEffect(() => {
    opacity.value = withTiming(1, {
      duration: 420,
      easing: Easing.out(Easing.cubic),
    });
    scale.value = withSpring(1, { damping: 13, stiffness: 170, mass: 0.85 });
  }, [opacity, scale]);

  const entranceStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <View
      style={{
        transform: [{ scaleY: -1 }],
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 6,
        paddingVertical: 28,
      }}
    >
      <Animated.View
        style={[
          {
            alignItems: "center",
            gap: 12,
            width: "100%",
            maxWidth: 420,
          },
          entranceStyle,
        ]}
      >
        <View
          style={{
            width: 104,
            height: 104,
            borderRadius: 52,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme["--color-primary-subtle"],
          }}
        >
          <AgentAvatar size={84} pulse />
        </View>

        <View style={{ alignItems: "center", gap: 6 }}>
          <Typography
            variant="title-xl"
            style={{ color: theme["--color-foreground"], textAlign: "center" }}
          >
            {intro.title}
          </Typography>
          <Typography
            variant="body"
            style={{
              color: theme["--color-foreground-muted"],
              textAlign: "center",
              maxWidth: 330,
            }}
          >
            {intro.subtitle}
          </Typography>
        </View>

        {!atLimit ? (
          <View
            style={{
              width: "100%",
              gap: 10,
              marginTop: 8,
            }}
          >
            {starters.map((starter, index) => (
              <StarterPrompt
                key={starter}
                text={starter}
                index={index}
                onPress={onStarterPress}
              />
            ))}
          </View>
        ) : null}

        <View
          pointerEvents="none"
          style={{
            width: 138,
            height: 4,
            borderRadius: 99,
            overflow: "hidden",
            marginTop: 2,
            opacity: 0.8,
          }}
        >
          <LinearGradient
            colors={accentGradient.colors}
            start={accentGradient.start}
            end={accentGradient.end}
            style={StyleSheet.absoluteFillObject}
          />
        </View>
      </Animated.View>
    </View>
  );
}

function StarterPrompt({
  text,
  index,
  onPress,
}: {
  text: string;
  index: number;
  onPress: (text: string) => void;
}) {
  const theme = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    // A quick squish for tactile feedback, then spring back. The chip stays put
    // because tapping it now drops the text into the composer (and focuses it)
    // instead of sending — so the empty state remains until the user hits send.
    scale.value = withSequence(
      withTiming(0.96, { duration: 90 }),
      withSpring(1, { damping: 14, stiffness: 240 }),
    );
    onPress(text);
  };

  return (
    <Animated.View style={[{ width: "100%" }, animatedStyle]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={text}
        onPress={handlePress}
        style={({ pressed: isPressed }) => ({
          minHeight: 52,
          borderRadius: 16,
          paddingHorizontal: 16,
          paddingVertical: 14,
          justifyContent: "center",
          backgroundColor: isPressed
            ? theme["--color-card-pressed"]
            : theme["--color-card"],
          borderWidth: 1,
          borderColor:
            index % 2 === 0
              ? theme["--color-border"]
              : theme["--color-primary-muted"],
          shadowColor: "#000000",
          shadowOpacity: 0.08,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 5 },
          elevation: 2,
        })}
      >
        <Typography
          variant="body-sm"
          weight="semibold"
          style={{ color: theme["--color-foreground"], textAlign: "center" }}
        >
          {text}
        </Typography>
      </Pressable>
    </Animated.View>
  );
}
