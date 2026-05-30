import { AuthScaffold, GradientButton } from "@/components/AuthScaffold";
import { Input } from "@/components/Input";
import { Typography } from "@/components/Typography";
import type { SignInEmailError } from "@/services/firebase/emailAuth";
import { useAuthStore } from "@/store/auth";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";

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

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setErrorMessage(null);
    setSubmitting(true);
    const result = await signInEmail(email.trim(), password);
    setSubmitting(false);
    if (!result.success) {
      setErrorMessage(t(errorKey(result.error)));
    }
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
        </View>

        <View style={{ marginTop: 24, gap: 16 }}>
          <GradientButton
            title={t("auth.submitSignIn")}
            onPress={handleSubmit}
            loading={submitting}
            disabled={email.length === 0 || password.length === 0}
          />

          <Pressable
            onPress={() => router.replace("/auth/email")}
            hitSlop={8}
            style={({ pressed }) => ({
              alignSelf: "center",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Typography
              variant="body"
              style={{ color: "rgba(255,255,255,0.86)" }}
            >
              {t("auth.needAccount")}
            </Typography>
          </Pressable>
        </View>
      </View>
    </AuthScaffold>
  );
}
