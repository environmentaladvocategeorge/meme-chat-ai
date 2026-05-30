import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/auth";
import { useRouter } from "expo-router";
import { CheckCircle } from "phosphor-react-native";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from "react-native";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ChangeEmailScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const changeEmail = useAuthStore((s) => s.changeEmail);

  const [password, setPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const emailError =
    newEmail.length > 0 && !EMAIL_REGEX.test(newEmail)
      ? t("account.changeEmail.errors.invalidEmail")
      : null;

  const canSubmit =
    password.length > 0 && EMAIL_REGEX.test(newEmail) && !isSubmitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    const result = await changeEmail(password, newEmail.trim());
    setIsSubmitting(false);

    if (result.success) {
      setSucceeded(true);
      return;
    }

    switch (result.error) {
      case "invalid-credential":
        setErrorMessage(t("account.changeEmail.errors.invalidCredential"));
        break;
      case "email-already-in-use":
        setErrorMessage(t("account.changeEmail.errors.emailAlreadyInUse"));
        break;
      case "invalid-email":
        setErrorMessage(t("account.changeEmail.errors.invalidEmail"));
        break;
      case "too-many-requests":
        setErrorMessage(t("account.changeEmail.errors.tooManyRequests"));
        break;
      default:
        setErrorMessage(t("account.changeEmail.errors.generic"));
    }
  }, [canSubmit, changeEmail, password, newEmail, t]);

  return (
    <View style={{ flex: 1, backgroundColor: theme["--color-background"] }}>
      <AppHeader
        title={t("account.changeEmail.title")}
        onBack={() => router.back()}
        backAccessibilityLabel={t("common.back")}
      />
      {succeeded ? (
        <SuccessView
          title={t("account.changeEmail.successTitle")}
          body={t("account.changeEmail.successBody")}
          onDone={() => router.back()}
        />
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingHorizontal: 24,
              paddingTop: 24,
              paddingBottom: 48,
              gap: 16,
            }}
          >
            <Typography
              variant="body"
              style={{ color: theme["--color-foreground-secondary"] }}
            >
              {t("account.changeEmail.subtitle")}
            </Typography>

            {errorMessage ? <ErrorCard message={errorMessage} /> : null}

            <Input
              label={t("account.changeEmail.currentPasswordLabel")}
              placeholder={t("account.changeEmail.currentPasswordPlaceholder")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
            />

            <Input
              label={t("account.changeEmail.newEmailLabel")}
              placeholder={t("account.changeEmail.newEmailPlaceholder")}
              value={newEmail}
              onChangeText={setNewEmail}
              error={emailError}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
            />

            <Button
              title={
                isSubmitting
                  ? t("account.changeEmail.submitting")
                  : t("account.changeEmail.submit")
              }
              loading={isSubmitting}
              disabled={!canSubmit}
              onPress={() => void handleSubmit()}
              style={{ marginTop: 8 }}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

export function ErrorCard({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme["--color-error"],
        backgroundColor: theme["--color-error-muted"],
      }}
    >
      <Typography variant="caption" style={{ color: theme["--color-error"] }}>
        {message}
      </Typography>
    </View>
  );
}

export function SuccessView({
  title,
  body,
  onDone,
}: {
  title: string;
  body: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        paddingHorizontal: 24,
        paddingBottom: 48,
        justifyContent: "center",
        alignItems: "center",
        gap: 16,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 22,
          backgroundColor: theme["--color-success-muted"],
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CheckCircle
          size={34}
          weight="fill"
          color={theme["--color-success"]}
        />
      </View>
      <Typography
        variant="title-md"
        style={{ color: theme["--color-foreground"], textAlign: "center" }}
      >
        {title}
      </Typography>
      <Typography
        variant="body"
        style={{
          color: theme["--color-foreground-secondary"],
          textAlign: "center",
          maxWidth: 300,
        }}
      >
        {body}
      </Typography>
      <View style={{ alignSelf: "stretch", marginTop: 8 }}>
        <Button title={t("common.done")} onPress={onDone} />
      </View>
    </View>
  );
}
