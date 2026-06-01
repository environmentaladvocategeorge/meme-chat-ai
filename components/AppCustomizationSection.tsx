import { AppPressable } from "@/components/AppPressable";
import { useChatAppearance } from "@/hooks/useChatAppearance";
import { useOpenPlan } from "@/hooks/useOpenPlan";
import { useTheme } from "@/hooks/useTheme";
import { useChatCustomizationSheetStore } from "@/store/chatCustomizationSheet";
import { CaretRight, LockSimple, Palette } from "phosphor-react-native";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Typography } from "./Typography";

// Clean "Customize Chat" trigger row, slotted inside the Appearance settings
// row. Paid users open the Customize Chat bottom sheet; free users are routed
// to the paywall. All the actual options live in the sheet to keep the
// settings page uncluttered.
export function AppCustomizationSection() {
  const { t } = useTranslation();
  const theme = useTheme();

  const { canCustomize } = useChatAppearance();
  const openPlan = useOpenPlan();
  const openSheet = useChatCustomizationSheetStore((s) => s.open);

  const onPress = canCustomize ? openSheet : openPlan;

  return (
    <AppPressable
      onPress={onPress}
      feedback="opacity"
      accessibilityLabel={
        canCustomize
          ? t("settings.customization.title")
          : t("settings.customization.unlockCta")
      }
      style={{
        marginTop: 4,
        borderTopWidth: 1,
        borderTopColor: theme["--color-border"],
        paddingTop: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
      }}
    >
      <Palette size={20} weight="regular" color={theme["--color-foreground"]} />
      <Typography
        variant="body"
        weight="semibold"
        style={{ flex: 1, color: theme["--color-foreground"] }}
      >
        {t("settings.customization.title")}
      </Typography>

      {canCustomize ? (
        <CaretRight
          size={18}
          weight="bold"
          color={theme["--color-foreground-muted"]}
        />
      ) : (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 6,
            paddingHorizontal: 12,
            borderRadius: 999,
            backgroundColor: theme["--color-primary"],
          }}
        >
          <LockSimple
            size={14}
            weight="fill"
            color={theme["--color-primary-foreground"]}
          />
          <Typography
            variant="label"
            style={{ color: theme["--color-primary-foreground"] }}
          >
            {t("settings.customization.unlock")}
          </Typography>
        </View>
      )}
    </AppPressable>
  );
}
