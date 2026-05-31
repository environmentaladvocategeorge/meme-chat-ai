import { AccountBody } from "@/components/account/parts";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/auth";
import { WarningCircle } from "phosphor-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, View } from "react-native";

export function DeleteAccountForm({
  onBusyChange,
  onDone,
}: {
  // Reports the in-flight deletion state up so the sheet can lock dismissal.
  onBusyChange?: (busy: boolean) => void;
  // Called once the account is actually deleted (the root layout then routes
  // back to the landing screen as auth flips to signed-out).
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const deleteAccountWithApple = useAuthStore((s) => s.deleteAccountWithApple);
  const providers = useAuthStore((s) => s.providers);

  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    onBusyChange?.(isSubmitting);
  }, [isSubmitting, onBusyChange]);

  const reauthMode = useMemo<"password" | "apple">(() => {
    if (providers.some((p) => p.providerId === "password")) return "password";
    return "apple";
  }, [providers]);

  const canSubmit = reauthMode === "password" ? password.length > 0 : true;

  const mapError = useCallback(
    (error: string) => {
      switch (error) {
        case "invalid-credential":
          return t("account.deleteAccount.errors.invalidCredential");
        case "too-many-requests":
          return t("account.deleteAccount.errors.tooManyRequests");
        case "firestore-delete-failed":
          return t("account.deleteAccount.errors.firestoreDeleteFailed");
        case "apple-cancelled":
          return t("account.deleteAccount.errors.appleCancelled");
        case "apple-unavailable":
          return t("account.deleteAccount.errors.appleUnavailable");
        case "apple-user-mismatch":
          return t("account.deleteAccount.errors.appleUserMismatch");
        case "reauth-failed":
          return t("account.deleteAccount.errors.reauthFailed");
        default:
          return t("account.deleteAccount.errors.generic");
      }
    },
    [t],
  );

  const handleDelete = useCallback(() => {
    if (!canSubmit || isSubmitting) return;

    Alert.alert(
      t("account.deleteAccount.confirmTitle"),
      t("account.deleteAccount.confirmMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("account.deleteAccount.confirmButton"),
          style: "destructive",
          onPress: () => {
            void (async () => {
              setIsSubmitting(true);
              setErrorMessage(null);

              const result =
                reauthMode === "apple"
                  ? await deleteAccountWithApple()
                  : await deleteAccount(password);

              if (!result.success) {
                setIsSubmitting(false);
                setErrorMessage(mapError(result.error));
                return;
              }
              // Success: close the sheet; the root layout routes back to the
              // landing screen as soon as auth status flips to signed-out.
              onDone?.();
            })();
          },
        },
      ],
      { cancelable: true },
    );
  }, [
    canSubmit,
    isSubmitting,
    password,
    reauthMode,
    deleteAccount,
    deleteAccountWithApple,
    mapError,
    onDone,
    t,
  ]);

  return (
    <AccountBody>
      {/* Warning banner */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 10,
          padding: 14,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: theme["--color-error"],
          backgroundColor: theme["--color-error-muted"],
        }}
      >
        <WarningCircle
          size={18}
          weight="fill"
          color={theme["--color-error"]}
          style={{ marginTop: 1 }}
        />
        <Typography
          variant="caption"
          style={{ flex: 1, color: theme["--color-foreground-secondary"] }}
        >
          {t("account.deleteAccount.subtitle")}
        </Typography>
      </View>

      {errorMessage ? (
        <View
          style={{
            padding: 14,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: theme["--color-error"],
            backgroundColor: theme["--color-card"],
          }}
        >
          <Typography variant="caption" style={{ color: theme["--color-error"] }}>
            {errorMessage}
          </Typography>
        </View>
      ) : null}

      {reauthMode === "password" ? (
        <Input
          bottomSheet
          label={t("account.deleteAccount.passwordLabel")}
          placeholder={t("account.deleteAccount.passwordPlaceholder")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          editable={!isSubmitting}
        />
      ) : (
        <Typography
          variant="body"
          style={{ color: theme["--color-foreground-secondary"] }}
        >
          {t("account.deleteAccount.appleReauthBody")}
        </Typography>
      )}

      <Button
        title={
          isSubmitting
            ? t("account.deleteAccount.submitting")
            : t("account.deleteAccount.submit")
        }
        loading={isSubmitting}
        disabled={!canSubmit || isSubmitting}
        onPress={handleDelete}
        style={{ marginTop: 8, backgroundColor: theme["--color-error"] }}
      />
    </AccountBody>
  );
}
