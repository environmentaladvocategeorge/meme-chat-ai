import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { useTheme } from "@/hooks/useTheme";
import { useOnboardingStore } from "@/store/onboarding";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// Placeholder onboarding step. Replace this file (or add sibling routes in
// app/onboarding/) with the real flow your app needs. The dispatcher in
// app/_layout.tsx will keep the user here until setCompleted(true) runs.
export default function OnboardingWelcome() {
  const { t } = useTranslation();
  const theme = useTheme();
  const setCompleted = useOnboardingStore((s) => s.setCompleted);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme["--color-background"] }}
      edges={["top", "bottom"]}
    >
      <View
        style={{
          flex: 1,
          paddingHorizontal: 24,
          paddingTop: 24,
          paddingBottom: 24,
          justifyContent: "space-between",
        }}
      >
        <PageHeader
          title={t("onboarding.welcomeTitle")}
          subtitle={t("onboarding.welcomeBody")}
        />
        <Button
          title={t("onboarding.continue")}
          onPress={() => setCompleted(true)}
        />
      </View>
    </SafeAreaView>
  );
}
