import { AppHeader, useAppHeaderHeight } from "@/components/AppHeader";
import { PlanAndUsage } from "@/components/PlanAndUsage";
import { useTheme } from "@/hooks/useTheme";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";

// Standalone /plan route. The same content is also surfaced as a global
// bottom sheet (PlanSheet); this route is kept as a navigable fallback.
export default function PlanScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  };

  const headerHeight = useAppHeaderHeight();

  return (
    <View style={{ flex: 1, backgroundColor: theme["--color-background"] }}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: headerHeight + 8,
          paddingBottom: 48,
        }}
        scrollIndicatorInsets={{ top: headerHeight }}
      >
        <PlanAndUsage />
      </ScrollView>
      <AppHeader
        title={t("settings.plan.heading")}
        onBack={handleBack}
        backAccessibilityLabel={t("common.back")}
      />
    </View>
  );
}
