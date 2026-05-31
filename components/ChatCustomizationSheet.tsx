// Global Customize Chat bottom sheet. Mounted once in the root layout and
// driven by useChatCustomizationSheetStore, so the settings "Customize Chat"
// row can summon it in place and keep the settings page itself clean.
//
// Two-level UI: a "hub" showing the live preview + an entry button per control
// (message bubbles / background), each drilling into the full set of color
// options for that control. This keeps the first screen calm — you see how the
// chat looks now and pick what to change — instead of two color rows at once.

import {
  backgroundSwatches,
  bubbleSwatches,
  DEFAULT_BACKGROUND,
  DEFAULT_BUBBLE_STYLE,
  makeCustomColorId,
  parseCustomColor,
} from "@/domain/customization";
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
  TouchableOpacity as BottomSheetTouchableOpacity,
} from "@gorhom/bottom-sheet";
import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowCounterClockwise,
  CaretLeft,
  CaretRight,
} from "phosphor-react-native";
import { useColorScheme } from "nativewind";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatAppearancePreview } from "./ChatAppearancePreview";
import {
  CustomColorSheet,
  type CustomColorTarget,
} from "./CustomColorSheet";
import { SwatchPicker } from "./SwatchPicker";
import { Typography } from "./Typography";

type Gradient = readonly [string, string, ...string[]];

// Which screen of the sheet is showing: the hub, or one control's options.
type SheetView = "hub" | "bubble" | "background";

export function ChatCustomizationSheet() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme ?? "light";
  const insets = useSafeAreaInsets();

  const isOpen = useChatCustomizationSheetStore((s) => s.isOpen);
  const close = useChatCustomizationSheetStore((s) => s.close);

  const chatBubbleStyle = useSettingsStore((s) => s.chatBubbleStyle);
  const setChatBubbleStyle = useSettingsStore((s) => s.setChatBubbleStyle);
  const chatBackground = useSettingsStore((s) => s.chatBackground);
  const setChatBackground = useSettingsStore((s) => s.setChatBackground);
  const resetChatAppearance = useSettingsStore((s) => s.resetChatAppearance);

  // Resolved look (for the little "current selection" chips on the hub buttons).
  const { bubble, background } = useChatAppearance();

  const isDefault =
    chatBubbleStyle === DEFAULT_BUBBLE_STYLE &&
    chatBackground === DEFAULT_BACKGROUND;

  // Which screen is showing, and which control (if any) the custom color picker
  // is open for.
  const [view, setView] = useState<SheetView>("hub");
  const [pickerTarget, setPickerTarget] = useState<CustomColorTarget | null>(
    null,
  );

  // Seed the picker with the current custom pick when there is one, otherwise a
  // pleasant on-brand starting color.
  const bubbleSeed =
    parseCustomColor(chatBubbleStyle) ?? theme["--color-primary"];
  const backgroundSeed =
    parseCustomColor(chatBackground) ?? theme["--color-primary"];

  const applyCustomColor = useCallback(
    (hex: string) => {
      const id = makeCustomColorId(hex);
      if (pickerTarget === "bubble") setChatBubbleStyle(id);
      else if (pickerTarget === "background") setChatBackground(id);
    },
    [pickerTarget, setChatBubbleStyle, setChatBackground],
  );

  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ["75%"], []);

  useEffect(() => {
    if (isOpen) {
      sheetRef.current?.present();
      setView("hub"); // always (re)open on the hub
    } else {
      sheetRef.current?.dismiss();
    }
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
          {/* Header: hub shows title + Reset; a detail view shows a back row. */}
          {view === "hub" ? (
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

              <BottomSheetTouchableOpacity
                onPress={resetChatAppearance}
                disabled={isDefault}
                accessibilityRole="button"
                accessibilityLabel={t("settings.customization.reset")}
                activeOpacity={0.8}
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
              </BottomSheetTouchableOpacity>
            </View>
          ) : (
            <BottomSheetTouchableOpacity
              onPress={() => setView("hub")}
              accessibilityRole="button"
              accessibilityLabel={t("settings.customization.back")}
              activeOpacity={0.7}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                alignSelf: "flex-start",
              }}
            >
              <CaretLeft
                size={20}
                weight="bold"
                color={theme["--color-foreground"]}
              />
              <Typography
                variant="title-lg"
                style={{
                  color: theme["--color-foreground"],
                  fontWeight: "800",
                }}
              >
                {view === "background"
                  ? t("settings.customization.customizeBackground")
                  : t("settings.customization.customizeMessages")}
              </Typography>
            </BottomSheetTouchableOpacity>
          )}

          {/* Live preview of the picked look — shown on every screen. */}
          <View style={{ gap: 10 }}>
            <Typography
              variant="title-sm"
              style={{ color: theme["--color-foreground"] }}
            >
              {t("settings.customization.preview")}
            </Typography>
            <ChatAppearancePreview />
          </View>

          {view === "hub" ? (
            // Hub: one entry button per control, each previewing its current pick.
            <View style={{ gap: 12 }}>
              <CustomizeRow
                label={t("settings.customization.customizeBackground")}
                gradient={background.gradientColors}
                solid={background.color}
                onPress={() => setView("background")}
              />
              <CustomizeRow
                label={t("settings.customization.customizeMessages")}
                gradient={bubble.gradientColors}
                solid={bubble.solidColor}
                onPress={() => setView("bubble")}
              />
            </View>
          ) : view === "background" ? (
            <SwatchPicker
              options={backgroundSwatches(theme)}
              value={chatBackground}
              onChange={setChatBackground}
              onCustomPress={() => setPickerTarget("background")}
              labelPrefix={t("settings.customization.background")}
              customLabel={t("settings.customization.customBackgroundTitle")}
            />
          ) : (
            <SwatchPicker
              options={bubbleSwatches(scheme)}
              value={chatBubbleStyle}
              onChange={setChatBubbleStyle}
              onCustomPress={() => setPickerTarget("bubble")}
              labelPrefix={t("settings.customization.messageStyle")}
              customLabel={t("settings.customization.customBubbleTitle")}
            />
          )}
        </BottomSheetScrollView>
      </BottomSheetModal>

      <CustomColorSheet
        target={pickerTarget}
        seedColor={pickerTarget === "background" ? backgroundSeed : bubbleSeed}
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
    <BottomSheetTouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      activeOpacity={0.85}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 16,
        backgroundColor: theme["--color-card-muted"],
      }}
    >
      <View
        style={{
          width: 52,
          height: 34,
          borderRadius: 9,
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
    </BottomSheetTouchableOpacity>
  );
}
