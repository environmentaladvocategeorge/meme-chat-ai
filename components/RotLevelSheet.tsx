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

import { useTheme } from "@/hooks/useTheme";
import { MAX_CONTENT_WIDTH } from "@/components/MaxWidthFrame";
import { SheetBackdrop } from "@/components/SheetBackdrop";
import { Typography } from "@/components/Typography";
import { useChatStore } from "@/store/chat";
import { useRotLevelSheetStore } from "@/store/rotLevelSheet";
import {
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
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

const POP_SPRING = { damping: 12, stiffness: 320, mass: 0.6 } as const;

function clampLevel(level: number): number {
  return Math.min(Math.max(Math.round(level), 1), LEVEL_COUNT);
}

function ToneCard({
  emoji,
  name,
  isSelected,
  a11yLabel,
  onPress,
  reduceMotion,
}: {
  emoji: string;
  name: string;
  isSelected: boolean;
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
        withTiming(0.93, { duration: 80 }),
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
          paddingVertical: 14,
          paddingHorizontal: 6,
          borderRadius: 14,
          borderWidth: isSelected ? 2 : 1,
          borderColor: isSelected
            ? theme["--color-primary"]
            : theme["--color-border"],
          backgroundColor: isSelected
            ? theme["--color-primary-subtle"]
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
      </Pressable>
    </Animated.View>
  );
}

export function RotLevelSheet() {
  const { t } = useTranslation();
  const theme = useTheme();
  const reduceMotion = useReducedMotion();

  const isOpen = useRotLevelSheetStore((s) => s.isOpen);
  const close = useRotLevelSheetStore((s) => s.close);
  const level = useChatStore((s) => s.rotLevel);
  const setRotLevel = useChatStore((s) => s.setRotLevel);

  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ["52%"], []);

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
  const levelReply = t(`chat.rot.levels.level${selected}.reply`);

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
      <BottomSheetView style={{ flex: 1, width: "100%", alignItems: "center" }}>
        {/* The sheet itself is full-width; on wide screens (iPad) constrain and
            center the content to the same column as the rest of the app,
            matching the PlanSheet. */}
        <View
          style={{
            flex: 1,
            width: "100%",
            maxWidth: MAX_CONTENT_WIDTH,
            paddingHorizontal: 20,
            paddingBottom: 24,
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
                  reduceMotion={reduceMotion}
                />
              );
            })}
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
      </BottomSheetView>
    </BottomSheetModal>
  );
}
