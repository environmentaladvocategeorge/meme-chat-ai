import { Button } from "@/components/Button";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/auth";
import * as AppleAuthentication from "expo-apple-authentication";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Platform, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function LandingScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const signInApple = useAuthStore((s) => s.signInApple);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [appleSubmitting, setAppleSubmitting] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    void AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
  }, []);

  const handleApple = async () => {
    setAppleSubmitting(true);
    const result = await signInApple();
    setAppleSubmitting(false);
    if (!result.success && result.error !== "cancelled") {
      Alert.alert(t("common.error"), t("auth.errors.generic"));
    }
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme["--color-background"] }}
      edges={["top", "bottom"]}
    >
      <View
        style={{
          flex: 1,
          paddingHorizontal: 24,
          justifyContent: "space-between",
          paddingTop: 32,
          paddingBottom: 24,
        }}
      >
        <View style={{ gap: 8 }}>
          <Typography
            variant="display"
            style={{ color: theme["--color-foreground"] }}
          >
            {t("landing.title")}
          </Typography>
          <Typography
            variant="body-lg"
            style={{ color: theme["--color-foreground-secondary"] }}
          >
            {t("landing.subtitle")}
          </Typography>
        </View>

        <View style={{ gap: 12 }}>
          <Button
            title={t("landing.signUp")}
            variant="primary"
            onPress={() => router.push("/auth/email")}
          />
          <Button
            title={t("landing.signIn")}
            variant="outline"
            onPress={() => router.push("/auth/sign-in")}
          />
          {appleAvailable ? (
            <Button
              title={t("landing.continueWithApple")}
              variant="ghost"
              loading={appleSubmitting}
              onPress={handleApple}
            />
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}
