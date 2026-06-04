import { AppPressable, SheetTouchableProvider } from "@/components/AppPressable";
import { SheetBackdrop } from "@/components/SheetBackdrop";
import { Typography } from "@/components/Typography";
import { MAX_CONTENT_WIDTH } from "@/components/MaxWidthFrame";
import { useTheme } from "@/hooks/useTheme";
import { useLanguageSheetStore } from "@/store/languageSheet";
import { type Language, useSettingsStore } from "@/store/settings";
import {
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { Check, Globe } from "phosphor-react-native";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

const LANGUAGES: readonly Language[] = [
  "system",
  "en",
  "es",
  "fr",
  "pt",
  "de",
  "zh",
  "ja",
  "hi",
  "ru",
];

export function LanguageSheet() {
  const { t } = useTranslation();
  const theme = useTheme();

  const isOpen = useLanguageSheetStore((s) => s.isOpen);
  const close = useLanguageSheetStore((s) => s.close);
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);

  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ["65%"], []);

  useEffect(() => {
    if (isOpen) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [isOpen]);

  const handleSelect = useCallback(
    (lang: Language) => {
      setLanguage(lang);
      close();
    },
    [setLanguage, close],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <SheetBackdrop {...props} opacity={0.5} />
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
        backgroundColor: theme["--color-foreground-muted"],
      }}
    >
      <SheetTouchableProvider>
        <BottomSheetScrollView
          contentContainerStyle={{
            width: "100%",
            maxWidth: MAX_CONTENT_WIDTH,
            alignSelf: "center",
            paddingBottom: 32,
          }}
        >
          {/* Header */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 20,
              paddingTop: 8,
              paddingBottom: 16,
            }}
          >
            <Globe
              size={22}
              weight="regular"
              color={theme["--color-foreground"]}
            />
            <Typography
              variant="title-lg"
              style={{ color: theme["--color-foreground"] }}
            >
              {t("settings.language.label")}
            </Typography>
          </View>

          {/* Language rows */}
          <View
            style={{
              marginHorizontal: 20,
              borderRadius: 16,
              backgroundColor: theme["--color-card"],
              borderWidth: 1,
              borderColor: theme["--color-border"],
              overflow: "hidden",
            }}
          >
            {LANGUAGES.map((lang, index) => {
              const isSelected = language === lang;
              return (
                <AppPressable
                  key={lang}
                  onPress={() => handleSelect(lang)}
                  feedback="opacity"
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 16,
                    paddingVertical: 15,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: theme["--color-border"],
                    gap: 12,
                  }}
                >
                  <Typography
                    variant="body"
                    style={{
                      flex: 1,
                      color: isSelected
                        ? theme["--color-primary"]
                        : theme["--color-foreground"],
                      fontWeight: isSelected ? "600" : "400",
                    }}
                  >
                    {t(`settings.language.${lang}` as const)}
                  </Typography>
                  {isSelected && (
                    <Check
                      size={20}
                      weight="bold"
                      color={theme["--color-primary"]}
                    />
                  )}
                </AppPressable>
              );
            })}
          </View>
        </BottomSheetScrollView>
      </SheetTouchableProvider>
    </BottomSheetModal>
  );
}
