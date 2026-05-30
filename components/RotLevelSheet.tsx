// RotLevelSheet
//
// The "Rot Level" picker — a bottom sheet for choosing a chat personality, not
// adjusting a machine setting. Three tone cards (Lightly Cooked / Rotted /
// Goblin Mode) sit in a row; tapping one selects it with a soft pop. Below the
// cards a live "show, don't tell" preview answers one fixed question in the
// selected tone, so the choice feels useful instead of decorative.
//
// Design intent is "equipping a persona", playful but contained: quiet card
// surfaces, a brand-tinted selected state with a colored border, a small emoji
// "sticker", vibe tag chips, and one gradient Done pill. No always-running
// motion — the only animation is the tap pop and a gentle crossfade on the
// preview, both settling to rest. The preview lives in a fixed-height block so
// the Done button never shifts as copy changes between tiers.
//
// Architecture is plain React state now (the old gesture-driven rail is gone):
// the parent owns the value and this sheet edits it via `level` / `onChange`.

import { useTheme } from "@/hooks/useTheme";
import { gradients } from "@/nativewind-theme";
import { Typography } from "@/components/Typography";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

export type RotLevelSheetRef = {
  present: () => void;
  dismiss: () => void;
};

interface RotLevelSheetProps {
  // Current level (1–3). Owned by the parent.
  level: number;
  onChange: (level: number) => void;
}

// Single source of truth per tier. Non-locale presentation (emoji + the quiet
// accent used on the tier eyebrow/tags) lives here so adding a future fourth
// tier is one entry, not edits scattered across parallel arrays. Copy stays in
// the locale files under chat.rot.levels.levelN. `accent` resolves against the
// active theme at render time.
type RotLevelConfig = {
  level: number;
  emoji: string;
  accent: (theme: ReturnType<typeof useTheme>) => string;
};

const ROT_LEVELS: readonly RotLevelConfig[] = [
  { level: 1, emoji: "🤓", accent: (t) => t["--color-foreground-secondary"] },
  { level: 2, emoji: "😤", accent: (t) => t["--color-primary"] },
  { level: 3, emoji: "💀", accent: (t) => t["--color-secondary"] },
] as const;

const LEVEL_COUNT = ROT_LEVELS.length;
// The tier new chats start on (mirrors the chat store default). Gets a quiet
// "default" chip so the picker explains itself.
const DEFAULT_LEVEL = 2;

// Fixed height reserved for the preview block. Sized for the tallest reply in
// either locale so the Done button stays put as the tier changes.
const PREVIEW_HEIGHT = 188;

// Tap pop — quick dip then spring back. Snappy, settles immediately.
const POP_SPRING = { damping: 12, stiffness: 320, mass: 0.6 } as const;

function clampLevel(level: number): number {
  return Math.min(Math.max(Math.round(level), 1), LEVEL_COUNT);
}

// One selectable tone card. Owns its own pop animation so a tap feels tactile
// without driving any shared/global animation state.
function ToneCard({
  emoji,
  name,
  isSelected,
  isDefault,
  defaultLabel,
  a11yLabel,
  onPress,
  reduceMotion,
}: {
  emoji: string;
  name: string;
  isSelected: boolean;
  isDefault: boolean;
  defaultLabel: string;
  a11yLabel: string;
  onPress: () => void;
  reduceMotion: boolean;
}) {
  const theme = useTheme();
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = useCallback(() => {
    if (!reduceMotion) {
      scale.value = withSequence(
        withTiming(0.93, { duration: 90 }),
        withSpring(1, POP_SPRING),
      );
    }
    onPress();
  }, [onPress, reduceMotion, scale]);

  return (
    <Animated.View style={[{ flex: 1 }, animStyle]}>
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        accessibilityLabel={a11yLabel}
        style={{
          alignItems: "center",
          gap: 8,
          paddingVertical: 14,
          paddingHorizontal: 8,
          borderRadius: 20,
          borderWidth: isSelected ? 2 : 1,
          borderColor: isSelected
            ? theme["--color-primary"]
            : theme["--color-border"],
          backgroundColor: isSelected
            ? theme["--color-primary-subtle"]
            : theme["--color-card"],
        }}
      >
        {/* Default chip — only on the tier new chats start on. Reserves a row
            on every card (fixed height) so the emoji sits at the same Y. */}
        <View style={{ height: 14, justifyContent: "center" }}>
          {isDefault ? (
            <View
              style={{
                paddingHorizontal: 7,
                paddingVertical: 1,
                borderRadius: 7,
                backgroundColor: isSelected
                  ? theme["--color-primary"]
                  : theme["--color-background-muted"],
              }}
            >
              <Typography
                variant="micro"
                style={{
                  fontSize: 8,
                  lineHeight: 11,
                  letterSpacing: 0.3,
                  color: isSelected
                    ? theme["--color-primary-foreground"]
                    : theme["--color-foreground-muted"],
                }}
              >
                {defaultLabel.toUpperCase()}
              </Typography>
            </View>
          ) : null}
        </View>

        {/* Emoji "sticker" — soft tinted disc behind it on the selected card. */}
        <View
          style={{
            width: 46,
            height: 46,
            borderRadius: 23,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: isSelected
              ? theme["--color-card"]
              : theme["--color-background-muted"],
          }}
        >
          <Text style={{ fontSize: 26, lineHeight: 32 }}>{emoji}</Text>
        </View>

        <Typography
          variant="body-sm"
          numberOfLines={2}
          style={{
            textAlign: "center",
            fontWeight: isSelected ? "700" : "600",
            color: isSelected
              ? theme["--color-primary"]
              : theme["--color-foreground-secondary"],
          }}
        >
          {name}
        </Typography>
      </Pressable>
    </Animated.View>
  );
}

export const RotLevelSheet = forwardRef<RotLevelSheetRef, RotLevelSheetProps>(
  function RotLevelSheet({ level, onChange }, ref) {
    const { t } = useTranslation();
    const theme = useTheme();
    const { colorScheme } = useColorScheme();
    const gradient = gradients[colorScheme ?? "light"].primary;
    const reduceMotion = useReducedMotion();

    const sheetRef = useRef<BottomSheetModal>(null);
    const snapPoints = useMemo(() => ["62%"], []);

    useImperativeHandle(
      ref,
      () => ({
        present: () => sheetRef.current?.present(),
        dismiss: () => sheetRef.current?.dismiss(),
      }),
      [],
    );

    // The tier the cards + preview reflect. Mirrors the parent value but lets a
    // tap update instantly without waiting for the prop to round-trip.
    const [selected, setSelected] = useState(clampLevel(level));

    // Keep in sync when the value changes from outside (initial mount, parent
    // reset). Cheap no-op when it already matches.
    useEffect(() => {
      setSelected(clampLevel(level));
    }, [level]);

    const handleSelect = useCallback(
      (next: number) => {
        const clamped = clampLevel(next);
        setSelected(clamped);
        onChange(clamped);
      },
      [onChange],
    );

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          opacity={0.5}
          pressBehavior="close"
        />
      ),
      [],
    );

    const active = ROT_LEVELS[selected - 1] ?? ROT_LEVELS[1];
    const levelName = t(`chat.rot.levels.level${selected}.name`);
    const levelReply = t(`chat.rot.levels.level${selected}.reply`);
    const tags = t(`chat.rot.levels.level${selected}.tags`, {
      returnObjects: true,
    }) as string[];

    return (
      <BottomSheetModal
        ref={sheetRef}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        backgroundStyle={{ backgroundColor: theme["--color-card"] }}
        handleIndicatorStyle={{
          backgroundColor: theme["--color-foreground-muted"],
        }}
      >
        <BottomSheetView
          style={{ flex: 1, paddingHorizontal: 20, paddingBottom: 20 }}
        >
          {/* Header — conversational, product-personality not settings-page. */}
          <View style={{ gap: 4, paddingTop: 2 }}>
            <Typography
              variant="title-lg"
              style={{ color: theme["--color-foreground"] }}
            >
              {t("chat.rot.title")}
            </Typography>
            <Typography
              variant="caption"
              style={{ color: theme["--color-foreground-muted"] }}
            >
              {t("chat.rot.subtitle")}
            </Typography>
          </View>

          {/* Three tone cards. */}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 20 }}>
            {ROT_LEVELS.map((cfg) => {
              const name = t(`chat.rot.levels.level${cfg.level}.name`);
              return (
                <ToneCard
                  key={cfg.level}
                  emoji={cfg.emoji}
                  name={name}
                  isSelected={cfg.level === selected}
                  isDefault={cfg.level === DEFAULT_LEVEL}
                  defaultLabel={t("chat.rot.defaultBadge")}
                  a11yLabel={t("chat.rot.a11yValue", {
                    level: cfg.level,
                    name,
                  })}
                  onPress={() => handleSelect(cfg.level)}
                  reduceMotion={reduceMotion}
                />
              );
            })}
          </View>

          {/* Live preview — fixed height so Done never jumps; the inner block
              crossfades when the tier changes. */}
          <View style={{ height: PREVIEW_HEIGHT, marginTop: 22 }}>
            <Typography
              variant="overline"
              style={{
                color: theme["--color-foreground-muted"],
                marginBottom: 10,
              }}
            >
              {t("chat.rot.preview.eyebrow")}
            </Typography>

            <Animated.View
              key={selected}
              entering={reduceMotion ? undefined : FadeIn.duration(180)}
              exiting={reduceMotion ? undefined : FadeOut.duration(120)}
              style={{ position: "absolute", left: 0, right: 0, top: 26 }}
            >
              {/* User prompt — the fixed question every tone answers. */}
              <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
                <View
                  style={{
                    maxWidth: "86%",
                    paddingHorizontal: 13,
                    paddingVertical: 9,
                    borderRadius: 16,
                    borderBottomRightRadius: 5,
                    backgroundColor: theme["--color-primary"],
                  }}
                >
                  <Typography
                    variant="body"
                    style={{ color: theme["--color-primary-foreground"] }}
                  >
                    {t("chat.rot.preview.prompt")}
                  </Typography>
                </View>
              </View>

              {/* Bot reply in the selected tone — emoji avatar + bubble. */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-end",
                  gap: 8,
                  marginTop: 10,
                }}
              >
                <View
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme["--color-background-muted"],
                  }}
                >
                  <Text style={{ fontSize: 16, lineHeight: 20 }}>
                    {active.emoji}
                  </Text>
                </View>
                <View
                  style={{
                    flex: 1,
                    paddingHorizontal: 13,
                    paddingVertical: 10,
                    borderRadius: 16,
                    borderBottomLeftRadius: 5,
                    backgroundColor: theme["--color-background-muted"],
                  }}
                >
                  <Typography
                    variant="body"
                    style={{ color: theme["--color-foreground"] }}
                  >
                    {levelReply}
                  </Typography>
                </View>
              </View>

              {/* Vibe tags — playful flavor, kept to a tidy row. */}
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 6,
                  marginTop: 12,
                  marginLeft: 38,
                }}
              >
                {(Array.isArray(tags) ? tags : []).map((tag) => (
                  <View
                    key={tag}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 11,
                      backgroundColor: theme["--color-primary-subtle"],
                      borderWidth: 1,
                      borderColor: theme["--color-border"],
                    }}
                  >
                    <Typography
                      variant="micro"
                      style={{ color: active.accent(theme) }}
                    >
                      {tag}
                    </Typography>
                  </View>
                ))}
              </View>
            </Animated.View>
          </View>

          {/* Done */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("chat.rot.done")}
            onPress={() => sheetRef.current?.dismiss()}
            style={({ pressed }) => ({
              marginTop: "auto",
              height: 52,
              borderRadius: 26,
              overflow: "hidden",
              opacity: pressed ? 0.92 : 1,
            })}
          >
            <LinearGradient
              colors={gradient.colors}
              start={gradient.start}
              end={gradient.end}
              style={StyleSheet.absoluteFillObject}
            />
            <View
              style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
            >
              <Typography
                variant="title-sm"
                style={{ color: "#FFFFFF", fontWeight: "800" }}
              >
                {t("chat.rot.done")}
              </Typography>
            </View>
          </Pressable>
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);
