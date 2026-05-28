import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/auth";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function VerifyEmailScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const email = useAuthStore((s) => s.email);
  const refreshEmailVerified = useAuthStore((s) => s.refreshEmailVerified);
  const resendVerification = useAuthStore((s) => s.resendVerificationEmail);
  const signOut = useAuthStore((s) => s.signOut);
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);

  const handleCheck = async () => {
    setChecking(true);
    const verified = await refreshEmailVerified();
    setChecking(false);
    if (!verified) {
      Alert.alert(t("auth.verifyEmail.title"), t("auth.verifyEmail.body", { email }));
    }
  };

  const handleResend = async () => {
    setResending(true);
    const result = await resendVerification();
    setResending(false);
    if (result.success) {
      Alert.alert(t("auth.verifyEmail.resent"));
    } else {
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
          paddingTop: 16,
          paddingBottom: 24,
          justifyContent: "space-between",
        }}
      >
        <View style={{ gap: 16 }}>
          <PageHeader
            title={t("auth.verifyEmail.title")}
            subtitle={t("auth.verifyEmail.body", { email: email ?? "" })}
          />
        </View>

        <View style={{ gap: 12 }}>
          <Button
            title={t("auth.verifyEmail.checkAgain")}
            loading={checking}
            onPress={handleCheck}
          />
          <Button
            title={t("auth.verifyEmail.resend")}
            variant="outline"
            loading={resending}
            onPress={handleResend}
          />
          <Button
            title={t("auth.verifyEmail.signOut")}
            variant="ghost"
            onPress={() => void signOut()}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
