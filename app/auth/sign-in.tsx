import { AppPressable } from "@/components/AppPressable";
import { AuthScaffold, GradientButton } from "@/components/AuthScaffold";
import { Input } from "@/components/Input";
import { Typography } from "@/components/Typography";
import type { SignInEmailError } from "@/services/firebase/emailAuth";
import { useAuthStore } from "@/store/auth";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, View } from "react-native";

function errorKey(error: SignInEmailError) {
  switch (error) {
    case "invalid-email":
      return "auth.errors.invalidEmail";
    case "invalid-credential":
      return "auth.errors.invalidCredential";
    case "too-many-requests":
      return "auth.errors.tooManyRequests";
    default:
      return "auth.errors.generic";
  }
}

export default function SignInScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const signInEmail = useAuthStore((s) => s.signInEmail);
  const sendPasswordResetEmail = useAuthStore((s) => s.sendPasswordResetEmail);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleSubmit = async () => {
    setErrorMessage(null);
    setSubmitting(true);
    const result = await signInEmail(email.trim(), password);
    setSubmitting(false);
    if (!result.success) {
      setErrorMessage(t(errorKey(result.error)));
    }
  };

  // Forgot password: send a reset email to whatever's typed in the email field
  // (no dedicated screen — the reset link lands them back via deep link). We
  // require the email up front so we're not sending into the void.
  const handleForgotPassword = async () => {
    const trimmed = email.trim();
    if (trimmed.length === 0) {
      setErrorMessage(t("auth.errors.invalidEmail"));
      return;
    }
    setErrorMessage(null);
    setResetting(true);
    const result = await sendPasswordResetEmail(trimmed);
    setResetting(false);
    if (result.success) {
      Alert.alert(
        t("account.resetPassword.sentTitle"),
        t("account.resetPassword.sentBody"),
      );
      return;
    }
    const key =
      result.error === "invalid-email"
        ? "account.resetPassword.errors.invalidEmail"
        : result.error === "too-many-requests"
          ? "account.resetPassword.errors.tooManyRequests"
          : "account.resetPassword.errors.generic";
    Alert.alert(t("account.resetPassword.errorTitle"), t(key));
  };

  return (
    <AuthScaffold
      title={t("auth.signInTitle")}
      subtitle={t("auth.welcomeBack")}
      onBack={() => router.back()}
    >
      <View style={{ flex: 1 }}>
        <View style={{ gap: 14 }}>
          <Input
            tone="glass"
            label={t("auth.email")}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            placeholder={t("auth.emailPlaceholder")}
            value={email}
            onChangeText={setEmail}
          />
          <Input
            tone="glass"
            label={t("auth.password")}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            error={errorMessage}
          />

          <AppPressable
            onPress={handleForgotPassword}
            disabled={resetting}
            feedback="opacity"
            hitSlop={8}
            accessibilityLabel={t("auth.forgotPassword")}
            containerStyle={{ alignSelf: "flex-end" }}
            style={{ opacity: resetting ? 0.6 : 1 }}
          >
            <Typography
              variant="caption"
              style={{ color: "rgba(255,255,255,0.86)", fontWeight: "600" }}
            >
              {resetting
                ? t("account.resetPassword.sending")
                : t("auth.forgotPassword")}
            </Typography>
          </AppPressable>
        </View>

        <View style={{ marginTop: 24, gap: 16 }}>
          <GradientButton
            title={t("auth.submitSignIn")}
            onPress={handleSubmit}
            loading={submitting}
            disabled={email.length === 0 || password.length === 0}
          />

          <AppPressable
            onPress={() => router.replace("/auth/email")}
            feedback="opacity"
            hitSlop={8}
            accessibilityLabel={t("auth.needAccount")}
            containerStyle={{ alignSelf: "center" }}
          >
            <Typography
              variant="body"
              style={{ color: "rgba(255,255,255,0.86)" }}
            >
              {t("auth.needAccount")}
            </Typography>
          </AppPressable>
        </View>
      </View>
    </AuthScaffold>
  );
}
