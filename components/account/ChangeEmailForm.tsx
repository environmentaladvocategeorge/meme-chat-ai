import { AccountBody, ErrorCard, SuccessView } from "@/components/account/parts";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/auth";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ChangeEmailForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
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

  if (succeeded) {
    return (
      <AccountBody>
        <SuccessView
          title={t("account.changeEmail.successTitle")}
          body={t("account.changeEmail.successBody")}
          onDone={onDone}
        />
      </AccountBody>
    );
  }

  return (
    <AccountBody>
      <Typography
        variant="body"
        style={{ color: theme["--color-foreground-secondary"] }}
      >
        {t("account.changeEmail.subtitle")}
      </Typography>

      {errorMessage ? <ErrorCard message={errorMessage} /> : null}

      <Input
        bottomSheet
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
        bottomSheet
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
    </AccountBody>
  );
}
