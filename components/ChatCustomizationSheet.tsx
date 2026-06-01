// Global Customize Chat bottom sheet. Mounted once in the root layout and
// driven by useChatCustomizationSheetStore, so the settings "Customize Chat"
// row can summon it in place and keep the settings page itself clean.
//
// A calm "hub": the live preview + one entry button per control (background,
// message bubbles, accent, chat surfaces). Tapping any of them opens the single
// centralized color picker (CustomColorSheet) directly — presets and custom
// editing live together in there, so there's no separate swatch-grid step.

import {
  DEFAULT_BACKGROUND,
  DEFAULT_BUBBLE_STYLE,
  parseCustomColor,
  parseCustomGradient,
} from "@/domain/customization";
import { AppPressable, SheetTouchableProvider } from "@/components/AppPressable";
import { MAX_CONTENT_WIDTH } from "@/components/MaxWidthFrame";
import { SheetBackdrop } from "@/components/SheetBackdrop";
import { useChatAppearance } from "@/hooks/useChatAppearance";
import { useTheme } from "@/hooks/useTheme";
import { useChatCustomizationSheetStore } from "@/store/chatCustomizationSheet";
import { useSettingsStore } from "@/store/settings";
import {
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowCounterClockwise, CaretRight } from "phosphor-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatAppearancePreview } from "./ChatAppearancePreview";
import {
  CustomColorSheet,
  type CustomColorTarget,
} from "./CustomColorSheet";
import { Typography } from "./Typography";

type Gradient = readonly [string, string, ...string[]];

export function ChatCustomizationSheet() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const isOpen = useChatCustomizationSheetStore((s) => s.isOpen);
  const close = useChatCustomizationSheetStore((s) => s.close);

  const chatBubbleStyle = useSettingsStore((s) => s.chatBubbleStyle);
  const setChatBubbleStyle = useSettingsStore((s) => s.setChatBubbleStyle);
  const chatBackground = useSettingsStore((s) => s.chatBackground);
  const setChatBackground = useSettingsStore((s) => s.setChatBackground);
  const chatUiColors = useSettingsStore((s) => s.chatUiColors);
  const resetChatAppearance = useSettingsStore((s) => s.resetChatAppearance);

  // Resolved look (for the little "current selection" chips on the hub buttons).
  const { bubble, background, surface, chatTheme } = useChatAppearance();

  const isDefault =
    chatBubbleStyle === DEFAULT_BUBBLE_STYLE &&
    chatBackground === DEFAULT_BACKGROUND &&
    Object.keys(chatUiColors).length === 0;

  // Which control (if any) the centralized color picker is open for.
  const [pickerTarget, setPickerTarget] = useState<CustomColorTarget | null>(
    null,
  );

  // Seed the picker with the current custom pick when there is one, otherwise a
  // pleasant on-brand starting color.
  const bubbleCustomGradient = parseCustomGradient(chatBubbleStyle);
  const backgroundCustomGradient = parseCustomGradient(chatBackground);
  const bubbleSeed =
    parseCustomColor(chatBubbleStyle) ??
    bubbleCustomGradient?.colors[0] ??
    theme["--color-primary"];
  const backgroundSeed =
    parseCustomColor(chatBackground) ??
    backgroundCustomGradient?.colors[0] ??
    theme["--color-primary"];
  const accentSeed =
    chatUiColors.accent ??
    chatTheme["--color-primary"] ??
    theme["--color-primary"];
  const subtleSeed =
    chatUiColors.subtle ?? surface?.surface ?? theme["--color-card"];
  const textSeed = chatUiColors.text ?? chatTheme["--color-foreground"];

  const applyCustomColor = useCallback(
    (id: string) => {
      if (pickerTarget === "bubble") setChatBubbleStyle(id);
      else if (pickerTarget === "background") setChatBackground(id);
    },
    [pickerTarget, setChatBubbleStyle, setChatBackground],
  );

  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ["90%"], []);

  useEffect(() => {
    if (isOpen) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [isOpen]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <SheetBackdrop {...props} opacity={0.5} />
    ),
    [],
  );

  return (
    <>
      <BottomSheetModal
        ref={sheetRef}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        onDismiss={close}
        backgroundStyle={{
          backgroundColor: theme["--color-background-secondary"],
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
        }}
        handleIndicatorStyle={{
          width: 40,
          height: 4,
          borderRadius: 999,
          backgroundColor: theme["--color-border"],
        }}
      >
        <BottomSheetScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            // The sheet itself is full-width; on wide screens (iPad) constrain
            // and center the content to the same column as the rest of the app.
            width: "100%",
            maxWidth: MAX_CONTENT_WIDTH,
            alignSelf: "center",
            paddingHorizontal: 24,
            paddingTop: 6,
            paddingBottom: insets.bottom + 32,
            gap: 24,
          }}
        >
          <SheetTouchableProvider>
            {/* Header: title + Reset. */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <Typography
                variant="title-xl"
                style={{
                  color: theme["--color-foreground"],
                  fontWeight: "800",
                }}
              >
                {t("settings.customization.title")}
              </Typography>

              <AppPressable
                onPress={resetChatAppearance}
                disabled={isDefault}
                feedback="opacity"
                accessibilityLabel={t("settings.customization.reset")}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingVertical: 6,
                  paddingHorizontal: 10,
                  borderRadius: 999,
                  backgroundColor: theme["--color-card-muted"],
                  opacity: isDefault ? 0.4 : 1,
                }}
              >
                <ArrowCounterClockwise
                  size={15}
                  weight="bold"
                  color={theme["--color-foreground-secondary"]}
                />
                <Typography
                  variant="label"
                  style={{ color: theme["--color-foreground-secondary"] }}
                >
                  {t("settings.customization.reset")}
                </Typography>
              </AppPressable>
            </View>

            {/* Live preview of the picked look. */}
            <View style={{ gap: 10 }}>
              <Typography
                variant="title-sm"
                style={{ color: theme["--color-foreground"] }}
              >
                {t("settings.customization.preview")}
              </Typography>
              <ChatAppearancePreview />
            </View>

            {/* Hub: one entry button per control. Each opens the centralized
              color picker directly — presets + custom editing live in there. */}
            <View style={{ gap: 12 }}>
              <CustomizeRow
                label={t("settings.customization.customizeBackground")}
                gradient={background.gradientColors}
                solid={background.color}
                onPress={() => setPickerTarget("background")}
              />
              <CustomizeRow
                label={t("settings.customization.customizeMessages")}
                gradient={bubble.gradientColors}
                solid={bubble.solidColor}
                onPress={() => setPickerTarget("bubble")}
              />
              <CustomizeRow
                label={t("settings.customization.customizeAccent")}
                gradient={null}
                solid={accentSeed}
                onPress={() => setPickerTarget("accent")}
              />
              <CustomizeRow
                label={t("settings.customization.customizeSubtle")}
                gradient={null}
                solid={subtleSeed}
                onPress={() => setPickerTarget("subtle")}
              />
              <CustomizeRow
                label={t("settings.customization.customizeText")}
                gradient={null}
                solid={textSeed}
                onPress={() => setPickerTarget("text")}
              />
            </View>
          </SheetTouchableProvider>
        </BottomSheetScrollView>
      </BottomSheetModal>

      <CustomColorSheet
        target={pickerTarget}
        seedColor={
          pickerTarget === "background"
            ? backgroundSeed
            : pickerTarget === "accent"
              ? accentSeed
              : pickerTarget === "subtle"
                ? subtleSeed
                : pickerTarget === "text"
                  ? textSeed
                  : bubbleSeed
        }
        seedGradient={
          pickerTarget === "background"
            ? backgroundCustomGradient
            : pickerTarget === "bubble"
              ? bubbleCustomGradient
              : null
        }
        onApply={applyCustomColor}
        onClose={() => setPickerTarget(null)}
      />
    </>
  );
}

// A hub entry button: a chip previewing the control's current pick, the label,
// and a chevron. Tapping drills into that control's color options.
function CustomizeRow({
  label,
  gradient,
  solid,
  onPress,
}: {
  label: string;
  gradient: Gradient | null;
  solid: string | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <AppPressable
      onPress={onPress}
      accessibilityLabel={label}
      pressScale={0.02}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 16,
        backgroundColor: theme["--color-card-muted"],
      }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: theme["--color-border"],
          backgroundColor: solid ?? undefined,
        }}
      >
        {gradient ? (
          <LinearGradient
            colors={gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ width: "100%", height: "100%" }}
          />
        ) : null}
      </View>
      <Typography
        variant="body"
        weight="semibold"
        style={{ flex: 1, color: theme["--color-foreground"] }}
      >
        {label}
      </Typography>
      <CaretRight
        size={18}
        weight="bold"
        color={theme["--color-foreground-muted"]}
      />
    </AppPressable>
  );
}
