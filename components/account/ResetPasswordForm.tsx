import { AccountBody } from "@/components/account/parts";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/auth";
import {
  EnvelopeSimple,
  PaperPlaneTilt,
  WarningCircle,
} from "phosphor-react-native";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_SECONDS = 60;

export function ResetPasswordForm() {
  const { t } = useTranslation();
  const theme = useTheme();

  const authEmail = useAuthStore((s) => s.email);
  const sendReset = useAuthStore((s) => s.sendPasswordResetEmail);

  const [email, setEmail] = useState<string>(() => authEmail ?? "");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const trimmed = email.trim();
  const emailValid = EMAIL_REGEX.test(trimmed);
  const emailError =
    trimmed.length > 0 && !emailValid
      ? t("account.resetPassword.errors.invalidEmail")
      : null;

  const canSend = emailValid && status !== "sending" && secondsLeft === 0;

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    setStatus("sending");
    setErrorMessage(null);

    const result = await sendReset(trimmed);

    if (result.success) {
      setStatus("sent");
      setSecondsLeft(RESEND_COOLDOWN_SECONDS);
      return;
    }

    setStatus("error");
    switch (result.error) {
      case "invalid-email":
        setErrorMessage(t("account.resetPassword.errors.invalidEmail"));
        break;
      case "too-many-requests":
        setErrorMessage(t("account.resetPassword.errors.tooManyRequests"));
        break;
      default:
        setErrorMessage(t("account.resetPassword.errors.generic"));
    }
  }, [canSend, sendReset, trimmed, t]);

  // Resend cooldown ticker.
  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const id = setInterval(() => {
      setSecondsLeft((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  const sendLabel =
    status === "sending"
      ? t("account.resetPassword.sending")
      : status === "sent"
        ? secondsLeft > 0
          ? t("account.resetPassword.resendIn", { seconds: secondsLeft })
          : t("account.resetPassword.resend")
        : t("account.resetPassword.sendButton");

  return (
    <AccountBody>
      <Typography
        variant="body"
        style={{ color: theme["--color-foreground-secondary"] }}
      >
        {t("account.resetPassword.body")}
      </Typography>

      <Input
        bottomSheet
        label={t("account.resetPassword.emailLabel")}
        placeholder={t("account.resetPassword.emailPlaceholder")}
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          if (status !== "idle") {
            setStatus("idle");
            setErrorMessage(null);
          }
        }}
        error={emailError}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
      />

      <Button
        title={sendLabel}
        startIcon={PaperPlaneTilt}
        loading={status === "sending"}
        disabled={!canSend}
        onPress={() => void handleSend()}
      />

      {status === "sent" || status === "error" ? (
        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor:
              status === "error"
                ? theme["--color-error"]
                : theme["--color-success"],
            backgroundColor:
              status === "error"
                ? theme["--color-error-muted"]
                : theme["--color-success-muted"],
            padding: 16,
            gap: 12,
          }}
        >
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor:
                  status === "error"
                    ? theme["--color-error"]
                    : theme["--color-success"],
              }}
            >
              {status === "error" ? (
                <WarningCircle
                  size={22}
                  weight="fill"
                  color={theme["--color-primary-foreground"]}
                />
              ) : (
                <EnvelopeSimple
                  size={22}
                  weight="fill"
                  color={theme["--color-primary-foreground"]}
                />
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Typography
                variant="title-sm"
                style={{ color: theme["--color-foreground"] }}
              >
                {status === "error"
                  ? t("account.resetPassword.errorTitle")
                  : t("account.resetPassword.sentTitle")}
              </Typography>
              <Typography
                variant="caption"
                style={{ color: theme["--color-foreground-secondary"] }}
              >
                {trimmed}
              </Typography>
            </View>
          </View>

          {status === "sent" ? (
            <>
              <Typography
                variant="body"
                style={{ color: theme["--color-foreground-secondary"] }}
              >
                {t("account.resetPassword.sentBody")}
              </Typography>
              <Typography
                variant="caption"
                italic
                style={{ color: theme["--color-foreground-muted"] }}
              >
                {t("account.resetPassword.spamHint")}
              </Typography>
            </>
          ) : null}

          {status === "error" && errorMessage ? (
            <Typography variant="body" style={{ color: theme["--color-error"] }}>
              {errorMessage}
            </Typography>
          ) : null}
        </View>
      ) : null}
    </AccountBody>
  );
}
