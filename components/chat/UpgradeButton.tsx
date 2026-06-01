import { AppPressable } from "@/components/AppPressable";
import { Typography } from "@/components/Typography";
import { gradients } from "@/nativewind-theme";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

// Gradient CTA shared by the quota modal + usage block. Label flips to
// "See limits" on the top tier, where there's nothing left to upgrade to.
export function UpgradeButton({
  isTopTier,
  onPress,
  height = 52,
}: {
  isTopTier: boolean;
  onPress: () => void;
  height?: number;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const gradient = gradients[colorScheme ?? "light"].primary;
  const label = isTopTier ? t("chat.usage.seeLimits") : t("chat.usage.upgrade");

  return (
    <AppPressable
      accessibilityLabel={label}
      onPress={onPress}
      haptic
      feedback="opacity"
      style={{
        height,
        borderRadius: height / 2,
        overflow: "hidden",
      }}
    >
      <LinearGradient
        colors={gradient.colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Typography
          variant="title-sm"
          style={{ color: "#FFFFFF", fontWeight: "800" }}
        >
          {label}
        </Typography>
      </View>
    </AppPressable>
  );
}
