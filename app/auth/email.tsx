import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { PageHeader } from "@/components/PageHeader";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import type { RegisterEmailError } from "@/services/firebase/emailAuth";
import { useAuthStore } from "@/store/auth";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

function errorKey(error: RegisterEmailError) {
  switch (error) {
    case "invalid-email":
      return "auth.errors.invalidEmail";
    case "weak-password":
      return "auth.errors.weakPassword";
    case "email-already-in-use":
      return "auth.errors.emailInUse";
    default:
      return "auth.errors.generic";
  }
}

export default function EmailRegisterScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const registerEmail = useAuthStore((s) => s.registerEmail);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setErrorMessage(null);
    setSubmitting(true);
    const result = await registerEmail(email.trim(), password);
    setSubmitting(false);
    if (!result.success) {
      setErrorMessage(t(errorKey(result.error)));
    }
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme["--color-background"] }}
      edges={["top", "bottom"]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View
          style={{
            flex: 1,
            paddingHorizontal: 24,
            paddingTop: 16,
            paddingBottom: 24,
            gap: 24,
          }}
        >
          <PageHeader title={t("auth.signUpTitle")} />

          <View style={{ gap: 14 }}>
            <Input
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
              label={t("auth.password")}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="password-new"
              secureTextEntry
              placeholder={t("auth.passwordPlaceholder")}
              value={password}
              onChangeText={setPassword}
              error={errorMessage}
            />
          </View>

          <Button
            title={t("auth.submitSignUp")}
            onPress={handleSubmit}
            loading={submitting}
            disabled={email.length === 0 || password.length === 0}
          />

          <TouchableOpacity
            onPress={() => router.replace("/auth/sign-in")}
            activeOpacity={0.7}
            style={{ alignSelf: "center" }}
          >
            <Typography
              variant="body"
              style={{ color: theme["--color-primary"] }}
            >
              {t("auth.haveAccount")}
            </Typography>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
