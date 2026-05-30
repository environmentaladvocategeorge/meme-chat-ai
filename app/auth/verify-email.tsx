import { AuthScaffold, GradientButton } from "@/components/AuthScaffold";
import { useAuthStore } from "@/store/auth";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AppState, type AppStateStatus, View } from "react-native";

export default function VerifyEmailScreen() {
  const { t } = useTranslation();
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

  // Users typically verify by tapping the link in their email/phone, which
  // backgrounds the app. Re-check silently when they return to the foreground
  // so they don't have to tap "Check again" manually.
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        const cameToForeground =
          appState.current.match(/inactive|background/) &&
          nextState === "active";
        appState.current = nextState;
        if (cameToForeground) {
          void refreshEmailVerified();
        }
      },
    );
    return () => subscription.remove();
  }, [refreshEmailVerified]);

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
    <AuthScaffold
      title={t("auth.verifyEmail.title")}
      subtitle={t("auth.verifyEmail.body", { email: email ?? "" })}
    >
      <View style={{ flex: 1, justifyContent: "flex-end", gap: 12 }}>
        <GradientButton
          title={t("auth.verifyEmail.checkAgain")}
          loading={checking}
          onPress={handleCheck}
        />
        <GradientButton
          title={t("auth.verifyEmail.resend")}
          variant="glass"
          loading={resending}
          onPress={handleResend}
        />
        <GradientButton
          title={t("auth.verifyEmail.signOut")}
          variant="glass"
          onPress={() => void signOut()}
        />
      </View>
    </AuthScaffold>
  );
}
