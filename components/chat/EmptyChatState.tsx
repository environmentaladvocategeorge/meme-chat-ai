import { AppPressable } from "@/components/AppPressable";
import { GlassSurface } from "@/components/GlassSurface";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { gradients } from "@/nativewind-theme";
import { useOnboardingStore } from "@/store/onboarding";
import { useSettingsStore } from "@/store/settings";
import { useSelectedPersona, usePersonaSelectionReady } from "@/store/personas";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
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
  header,
  fadeProgress,
}: {
  onStarterPress: (text: string) => void;
  atLimit: boolean;
  // Optional slot above the intro (e.g. the "Memory is on" banner). Rendered
  // INSIDE the counter-flipped, scrollable empty state so it moves with the
  // content instead of pinning above the list and shearing against it when
  // the keyboard shrinks the viewport.
  header?: ReactNode;
  // The chat list's content-fade SharedValue. The starter prompts are glass and
  // the list fades to opacity 0 during a new-chat swap, which would blank the
  // glass — so it's forwarded to their GlassSurface to flip glassEffectStyle to
  // 'none' near 0 instead (Expo glass-fade). See GlassSurface's fadeProgress.
  fadeProgress?: SharedValue<number>;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const accentGradient = gradients[colorScheme ?? "light"].accent;
  // The hero avatar tracks the active chat persona, so an empty chat with a
  // user-built bot selected shows that bot (not always Brainrot Bot).
  const selectedPersona = useSelectedPersona();
  // Until the persisted pick resolves (restore + list load), don't render the
  // hero/intro — it would briefly show the default bot before the saved one
  // lands. A neutral "warming up" placeholder bridges that gap instead.
  const personaReady = usePersonaSelectionReady();
  // The rotating intros are written around the default bot's name ("Brainrot
  // Bot is awake"). When a user-built persona is selected, show ITS name in that
  // copy instead. defaultBotName is the localized default name the intros are
  // phrased with; swapping it for the selected persona's display name keeps the
  // rest of each line intact and is a no-op for the default persona.
  const defaultBotName = t("chat.agentName");
  const botName =
    selectedPersona.kind === "default"
      ? defaultBotName
      : selectedPersona.persona.displayName;

  // One-shot seeded first chat: the moment onboarding finishes, open with
  // Brainrot Bot's fixed welcome + the spec's prompt chips instead of a random intro,
  // so day one is never a blank composer. Captured once on mount (so a later
  // store update mid-session doesn't swap the copy out) and consumed so any
  // subsequent new chat reverts to the random pool.
  const consumeJustCompleted = useOnboardingStore((s) => s.consumeJustCompleted);
  const seedFirstChat = useRef(
    useOnboardingStore.getState().justCompleted && !atLimit,
  );
  // The "what brought you here" answer captured during onboarding, snapshotted
  // once (like seedFirstChat) so the seeded starters match the user's stated
  // intent — a "school" user lands on homework prompts, "memes" on meme prompts.
  const seededIntent = useRef(useSettingsStore.getState().intent);
  useEffect(() => {
    if (seedFirstChat.current) consumeJustCompleted();
  }, [consumeJustCompleted]);

  // Randomize which starters appear each time the empty state mounts (new
  // conversation / fresh load), drawn from the full pool in the locale file.
  // Right after onboarding, use the fixed seeded chips instead.
  const starters = useMemo(() => {
    if (seedFirstChat.current) {
      // Prefer intent-matched starters when onboarding captured an intent; fall
      // back to the generic seeded pool otherwise.
      const intent = seededIntent.current;
      if (intent) {
        const byIntent = t(`chat.firstChat.chipsByIntent.${intent}`, {
          returnObjects: true,
        });
        if (Array.isArray(byIntent) && byIntent.length > 0) {
          return (byIntent as string[]).slice(0, STARTER_COUNT);
        }
      }
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

  // Personalize the chosen intro to the selected persona. Kept in its own memo
  // so re-running it (when the name resolves) never reshuffles the random pick
  // above. split/join (not regex) so a persona name with regex-special chars is
  // safe; a no-op when the default bot is selected or the line names no bot.
  const displayIntro = useMemo(() => {
    if (botName === defaultBotName) return intro;
    const swap = (s: string) => s.split(defaultBotName).join(botName);
    return { title: swap(intro.title), subtitle: swap(intro.subtitle) };
  }, [intro, botName, defaultBotName]);

  // Entrance for the whole empty state. Plays once when this mounts — i.e. the
  // moment the loader clears and Brainrot Bot "wakes up". A gentle spring scale +
  // rise so it eases in instead of hard-blinking. The animated transform lives
  // on an inner view so it doesn't disturb the outer scaleY:-1 counter-flip the
  // inverted FlatList requires.
  //
  // NOTE: deliberately NO opacity fade. This view wraps the glass starter
  // prompts, and opacity 0 on a glass ancestor permanently kills the native
  // material (see GlassSurface's opacity-0 note) — which is why the prompts
  // were "sometimes glass, sometimes not". Motion-only entrance sidesteps it.
  const scale = useSharedValue(0.92);
  const translateY = useSharedValue(14);

  useEffect(() => {
    scale.value = withSpring(1, { damping: 13, stiffness: 170, mass: 0.85 });
    translateY.value = withSpring(0, {
      damping: 15,
      stiffness: 170,
      mass: 0.85,
    });
  }, [scale, translateY]);

  const entranceStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateY: translateY.value }],
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
      {header ? (
        <View style={{ width: "100%", marginBottom: 4 }}>{header}</View>
      ) : null}
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
        {/* No tinted circle behind the avatar: it floats, so a fixed teal ring
            read as a detached outline as it bobbed against it. The persona coin
            stands on its own — the active bot (default or user-built). */}
        <View
          style={{
            width: 104,
            height: 104,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {personaReady ? (
            <PersonaAvatar persona={selectedPersona} size={84} float />
          ) : (
            // Neutral coin while the pick resolves — no bot identity claimed yet.
            <View
              style={{
                width: 84,
                height: 84,
                borderRadius: 42,
                backgroundColor: theme["--color-card-muted"],
              }}
            />
          )}
        </View>

        <View style={{ alignItems: "center", gap: 6 }}>
          <Typography
            variant="title-xl"
            style={{ color: theme["--color-foreground"], textAlign: "center" }}
          >
            {personaReady ? displayIntro.title : t("chat.empty.warming")}
          </Typography>
          {personaReady && displayIntro.subtitle ? (
            <Typography
              variant="body"
              style={{
                color: theme["--color-foreground-muted"],
                textAlign: "center",
                maxWidth: 330,
              }}
            >
              {displayIntro.subtitle}
            </Typography>
          ) : null}
        </View>

        {!atLimit && personaReady ? (
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
                fadeProgress={fadeProgress}
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
  fadeProgress,
}: {
  text: string;
  index: number;
  onPress: (text: string) => void;
  fadeProgress?: SharedValue<number>;
}) {
  const theme = useTheme();

  // The press-squish now lives on AppPressable's inner surface (scale on a
  // pointerEvents="none" view) instead of a withSequence on an Animated.View
  // ancestor — same tactile feel, but the touch frame never moves.
  return (
    <AppPressable
      accessibilityLabel={text}
      onPress={() => onPress(text)}
      haptic
      pressScale={0.04}
      containerStyle={{ width: "100%" }}
      style={{
        minHeight: 52,
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 14,
        justifyContent: "center",
      }}
    >
      {/* Liquid Glass where supported — these float over the (often custom)
          chat background, so they refract. The previous solid card + tinted
          border is the non-glass fallback. */}
      <GlassSurface
        pointerEvents="none"
        fadeProgress={fadeProgress}
        style={[StyleSheet.absoluteFillObject, { borderRadius: 16 }]}
        fallbackStyle={{
          backgroundColor: theme["--color-card"],
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
        }}
      />
      <Typography
        variant="body-sm"
        weight="semibold"
        style={{ color: theme["--color-foreground"], textAlign: "center" }}
      >
        {text}
      </Typography>
    </AppPressable>
  );
}
