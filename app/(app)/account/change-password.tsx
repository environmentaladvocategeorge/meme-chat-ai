import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/auth";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from "react-native";
import { ErrorCard, SuccessView } from "./change-email";

export default function ChangePasswordScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const changePassword = useAuthStore((s) => s.changePassword);

  const [current, setCurrent] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const newPwError =
    newPw.length > 0 && newPw.length < 8
      ? t("account.changePassword.errors.weakPassword")
      : null;
  const confirmError =
    confirm.length > 0 && confirm !== newPw
      ? t("account.changePassword.errors.passwordMismatch")
      : null;

  const canSubmit =
    current.length > 0 &&
    newPw.length >= 8 &&
    confirm === newPw &&
    !isSubmitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    const result = await changePassword(current, newPw);
    setIsSubmitting(false);

    if (result.success) {
      setSucceeded(true);
      return;
    }

    switch (result.error) {
      case "invalid-credential":
        setErrorMessage(t("account.changePassword.errors.invalidCredential"));
        break;
      case "weak-password":
        setErrorMessage(t("account.changePassword.errors.weakPassword"));
        break;
      case "too-many-requests":
        setErrorMessage(t("account.changePassword.errors.tooManyRequests"));
        break;
      default:
        setErrorMessage(t("account.changePassword.errors.generic"));
    }
  }, [canSubmit, changePassword, current, newPw, t]);

  return (
    <View style={{ flex: 1, backgroundColor: theme["--color-background"] }}>
      <AppHeader
        title={t("account.changePassword.title")}
        onBack={() => router.back()}
        backAccessibilityLabel={t("common.back")}
      />
      {succeeded ? (
        <SuccessView
          title={t("account.changePassword.successTitle")}
          body={t("account.changePassword.successBody")}
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
              {t("account.changePassword.subtitle")}
            </Typography>

            {errorMessage ? <ErrorCard message={errorMessage} /> : null}

            <Input
              label={t("account.changePassword.currentLabel")}
              placeholder={t("account.changePassword.currentPlaceholder")}
              value={current}
              onChangeText={setCurrent}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
            />

            <Input
              label={t("account.changePassword.newLabel")}
              placeholder={t("account.changePassword.newPlaceholder")}
              value={newPw}
              onChangeText={setNewPw}
              error={newPwError}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
            />

            <Input
              label={t("account.changePassword.confirmLabel")}
              placeholder={t("account.changePassword.confirmPlaceholder")}
              value={confirm}
              onChangeText={setConfirm}
              error={confirmError}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
            />

            <Button
              title={
                isSubmitting
                  ? t("account.changePassword.submitting")
                  : t("account.changePassword.submit")
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
