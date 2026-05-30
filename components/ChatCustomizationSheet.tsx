// Global Customize Chat bottom sheet. Mounted once in the root layout and
// driven by useChatCustomizationSheetStore, so the settings "Customize Chat"
// row can summon it in place and keep the settings page itself clean.

import {
  backgroundSwatches,
  bubbleSwatches,
  DEFAULT_BACKGROUND,
  DEFAULT_BUBBLE_STYLE,
} from "@/domain/customization";
import { useTheme } from "@/hooks/useTheme";
import { useChatCustomizationSheetStore } from "@/store/chatCustomizationSheet";
import { useSettingsStore } from "@/store/settings";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
  TouchableOpacity as BottomSheetTouchableOpacity,
} from "@gorhom/bottom-sheet";
import { ArrowCounterClockwise } from "phosphor-react-native";
import { useColorScheme } from "nativewind";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatAppearancePreview } from "./ChatAppearancePreview";
import { SwatchPicker } from "./SwatchPicker";
import { Typography } from "./Typography";

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

  const isDefault =
    chatBubbleStyle === DEFAULT_BUBBLE_STYLE &&
    chatBackground === DEFAULT_BACKGROUND;

  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ["75%"], []);

  useEffect(() => {
    if (isOpen) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [isOpen]);

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

  return (
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
          paddingHorizontal: 24,
          paddingTop: 6,
          paddingBottom: insets.bottom + 32,
          gap: 24,
        }}
      >
        {/* Header: title + Reset top-right */}
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
            style={{ color: theme["--color-foreground"], fontWeight: "800" }}
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

        {/* Live preview of the picked look */}
        <View style={{ gap: 10 }}>
          <Typography
            variant="title-sm"
            style={{ color: theme["--color-foreground"] }}
          >
            {t("settings.customization.preview")}
          </Typography>
          <ChatAppearancePreview />
        </View>

        {/* Message style */}
        <View style={{ gap: 12 }}>
          <Typography
            variant="title-sm"
            style={{ color: theme["--color-foreground"] }}
          >
            {t("settings.customization.messageStyle")}
          </Typography>
          <SwatchPicker
            options={bubbleSwatches(scheme)}
            value={chatBubbleStyle}
            onChange={setChatBubbleStyle}
            labelPrefix={t("settings.customization.messageStyle")}
          />
        </View>

        {/* Chat background */}
        <View style={{ gap: 12 }}>
          <Typography
            variant="title-sm"
            style={{ color: theme["--color-foreground"] }}
          >
            {t("settings.customization.background")}
          </Typography>
          <SwatchPicker
            options={backgroundSwatches(theme)}
            value={chatBackground}
            onChange={setChatBackground}
            labelPrefix={t("settings.customization.background")}
          />
        </View>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}
