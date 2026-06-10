// RotLevelSheet
//
// The "Rot Level" picker — a bottom sheet for choosing a chat personality.
// Three compact tone tiles sit in a row; tapping one selects it with a soft
// pop. A live preview answers one fixed question in the selected tone inside
// a subtle chat-background container. The sheet is dismissed by swiping down
// or tapping the backdrop — no Done button needed.
//
// Mounted once at the root layout (outside the iPad content column) and driven
// by useRotLevelSheetStore, so the sheet spans the full screen width and stays
// centered on wide screens. The composer's RotLevelButton opens it via open().

import { AppPressable, SheetTouchableProvider } from "@/components/AppPressable";
import { useTheme } from "@/hooks/useTheme";
import { MAX_CONTENT_WIDTH } from "@/components/MaxWidthFrame";
import { SheetBackdrop } from "@/components/SheetBackdrop";
import { Typography } from "@/components/Typography";
import { useChatStore } from "@/store/chat";
import { useRotLevelSheetStore } from "@/store/rotLevelSheet";
import {
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { Smiley, Sticker } from "phosphor-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  FadeIn,
  FadeOut,
  useReducedMotion,
} from "react-native-reanimated";

type RotLevelConfig = {
  level: number;
  emoji: string;
};

const ROT_LEVELS: readonly RotLevelConfig[] = [
  { level: 1, emoji: "🤓" },
  { level: 2, emoji: "😤" },
  { level: 3, emoji: "💀" },
] as const;

const LEVEL_COUNT = ROT_LEVELS.length;

// Fixed height for the preview — tall enough for the longest tier reply.
const PREVIEW_HEIGHT = 220;

function clampLevel(level: number): number {
  return Math.min(Math.max(Math.round(level), 1), LEVEL_COUNT);
}

// Strips emoji (pictographs, dingbats, flags, ZWJ/variation selectors) from a
// string and tidies the whitespace they leave behind. Used to make the live
// preview honor "Respond with emojis: off" so the vibe sample matches what the
// user will actually get. Explicit codepoint ranges (not \p{...}) so it behaves
// the same across JS engines (Hermes included).
function stripEmojis(text: string): string {
  return text
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}]/gu,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Tone tile. Built on AppPressable: inside the sheet it resolves to the
// gesture-handler touch core (so it doesn't fight the pan gesture), and the
// press-pop lives on the inner pointerEvents="none" surface rather than a
// scaling ancestor that would shift the hit frame.
function ToneCard({
  emoji,
  name,
  isSelected,
  a11yLabel,
  onPress,
}: {
  emoji: string;
  name: string;
  isSelected: boolean;
  a11yLabel: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <AppPressable
      onPress={onPress}
      haptic
      pressScale={0.05}
      accessibilityLabel={a11yLabel}
      accessibilityState={{ selected: isSelected }}
      containerStyle={{ flex: 1 }}
      style={{
        alignItems: "center",
        paddingVertical: 14,
        paddingHorizontal: 6,
        borderRadius: 14,
        borderWidth: isSelected ? 2 : 1,
        borderColor: isSelected
          ? theme["--color-primary"]
          : theme["--color-border"],
        // Selection reads via the teal border + bold teal label, not a teal
        // fill — a tinted "primary-subtle" background looked like default AI UI.
        // A neutral grey keeps the tile grounded without the brand wash.
        backgroundColor: isSelected
          ? theme["--color-card-muted"]
          : theme["--color-card"],
        gap: 7,
      }}
    >
      <Text style={{ fontSize: 26, lineHeight: 30 }}>{emoji}</Text>
      <Typography
        variant="caption"
        numberOfLines={2}
        style={{
          textAlign: "center",
          fontWeight: isSelected ? "700" : "500",
          color: isSelected
            ? theme["--color-primary"]
            : theme["--color-foreground-secondary"],
        }}
      >
        {name}
      </Typography>
    </AppPressable>
  );
}

// A single answering-preference row (icon + label + switch). Local-only prefs
// that ride alongside the rot dial: emojis and reaction GIFs/memes.
function ToggleRow({
  icon,
  label,
  value,
  onValueChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme["--color-border"],
        backgroundColor: theme["--color-card"],
        paddingVertical: 12,
        paddingHorizontal: 14,
      }}
    >
      {icon}
      <Typography
        variant="body"
        weight="semibold"
        style={{ flex: 1, color: theme["--color-foreground"] }}
      >
        {label}
      </Typography>
      <Switch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={label}
        trackColor={{
          false: theme["--color-background-muted"],
          true: theme["--color-primary-subtle"],
        }}
        thumbColor={
          value ? theme["--color-primary"] : theme["--color-foreground-muted"]
        }
      />
    </View>
  );
}

export function RotLevelSheet() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const isOpen = useRotLevelSheetStore((s) => s.isOpen);
  const close = useRotLevelSheetStore((s) => s.close);
  const level = useChatStore((s) => s.rotLevel);
  const setRotLevel = useChatStore((s) => s.setRotLevel);
  // Local-only answering prefs, persisted on device and sent per turn.
  const respondWithEmojis = useChatStore((s) => s.respondWithEmojis);
  const respondWithMedia = useChatStore((s) => s.respondWithMedia);
  const setRespondWithEmojis = useChatStore((s) => s.setRespondWithEmojis);
  const setRespondWithMedia = useChatStore((s) => s.setRespondWithMedia);

  const sheetRef = useRef<BottomSheetModal>(null);
  // Scroll content sizes itself; the snap point is just the resting height. Tall
  // enough to seat the dial, both answering toggles, and the preview at once.
  const snapPoints = useMemo(() => ["74%"], []);

  useEffect(() => {
    if (isOpen) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [isOpen]);

  const [selected, setSelected] = useState(clampLevel(level));

  useEffect(() => {
    setSelected(clampLevel(level));
  }, [level]);

  const handleSelect = useCallback(
    (next: number) => {
      const clamped = clampLevel(next);
      setSelected(clamped);
      setRotLevel(clamped);
    },
    [setRotLevel],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <SheetBackdrop {...props} opacity={0.5} />
    ),
    [],
  );

  const active = ROT_LEVELS[selected - 1] ?? ROT_LEVELS[1];
  const rawLevelReply = t(`chat.rot.levels.level${selected}.reply`);
  // Mirror the emoji toggle in the live preview: with emojis off, the sample
  // reply shows no emojis either, so the vibe matches the real output.
  const levelReply = respondWithEmojis
    ? rawLevelReply
    : stripEmojis(rawLevelReply);

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onDismiss={close}
      backgroundStyle={{ backgroundColor: theme["--color-card"] }}
      handleIndicatorStyle={{
        backgroundColor: theme["--color-foreground-muted"],
      }}
    >
      <BottomSheetScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          // The sheet itself is full-width; on wide screens (iPad) constrain and
          // center the content to the same column as the rest of the app,
          // matching the PlanSheet. Scroll keeps the dial + preview + toggles
          // reachable on short devices where they'd otherwise overflow the snap.
          width: "100%",
          maxWidth: MAX_CONTENT_WIDTH,
          alignSelf: "center",
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 24,
        }}
      >
       <SheetTouchableProvider>
        <View
          style={{
            width: "100%",
          }}
        >
          {/* Header */}
          <View style={{ gap: 3, paddingTop: 2, marginBottom: 18 }}>
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

          {/* Three tone tiles */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            {ROT_LEVELS.map((cfg) => {
              const name = t(`chat.rot.levels.level${cfg.level}.name`);
              return (
                <ToneCard
                  key={cfg.level}
                  emoji={cfg.emoji}
                  name={name}
                  isSelected={cfg.level === selected}
                  a11yLabel={t("chat.rot.a11yValue", {
                    level: cfg.level,
                    name,
                  })}
                  onPress={() => handleSelect(cfg.level)}
                />
              );
            })}
          </View>

          {/* Answering toggles — local-only prefs that ride with the dial. */}
          <View style={{ marginTop: 16, gap: 8 }}>
            <ToggleRow
              icon={
                <Smiley size={20} weight="bold" color={theme["--color-foreground"]} />
              }
              label={t("settings.answering.emojisLabel")}
              value={respondWithEmojis}
              onValueChange={setRespondWithEmojis}
            />
            <ToggleRow
              icon={
                <Sticker
                  size={20}
                  weight="bold"
                  color={theme["--color-foreground"]}
                />
              }
              label={t("settings.answering.mediaLabel")}
              value={respondWithMedia}
              onValueChange={setRespondWithMedia}
            />
          </View>

          {/* Preview — subtle chat-surface container */}
          <View
            style={{
              marginTop: 16,
              borderRadius: 16,
              backgroundColor: theme["--color-background"],
              borderWidth: 1,
              borderColor: theme["--color-border"],
              padding: 14,
              overflow: "hidden",
              height: PREVIEW_HEIGHT,
            }}
          >
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
              style={{ position: "absolute", left: 14, right: 14, top: 34 }}
            >
              {/* User prompt */}
              <View
                style={{ flexDirection: "row", justifyContent: "flex-end" }}
              >
                <View
                  style={{
                    maxWidth: "84%",
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 14,
                    borderBottomRightRadius: 4,
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

              {/* Bot reply */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-end",
                  gap: 8,
                  marginTop: 8,
                }}
              >
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme["--color-card"],
                    borderWidth: 1,
                    borderColor: theme["--color-border"],
                  }}
                >
                  <Text style={{ fontSize: 14, lineHeight: 18 }}>
                    {active.emoji}
                  </Text>
                </View>
                <View
                  style={{
                    flex: 1,
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                    borderRadius: 14,
                    borderBottomLeftRadius: 4,
                    backgroundColor: theme["--color-card"],
                    borderWidth: 1,
                    borderColor: theme["--color-border"],
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
            </Animated.View>
          </View>
        </View>
       </SheetTouchableProvider>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}
