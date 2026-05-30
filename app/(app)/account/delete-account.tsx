import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/auth";
import { useNavigation, useRouter } from "expo-router";
import { WarningCircle } from "phosphor-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from "react-native";

export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();

  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const deleteAccountWithApple = useAuthStore((s) => s.deleteAccountWithApple);
  const providers = useAuthStore((s) => s.providers);

  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Once the deletion call is in flight, block the back gesture/button so the
  // teardown (callable → sign out → local wipe) can complete uninterrupted.
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (!isSubmitting) return;
      e.preventDefault();
    });
    return unsubscribe;
  }, [navigation, isSubmitting]);

  const reauthMode = useMemo<"password" | "apple">(() => {
    if (providers.some((p) => p.providerId === "password")) return "password";
    return "apple";
  }, [providers]);

  const canSubmit =
    reauthMode === "password" ? password.length > 0 : true;

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
              // On success the root layout routes back to the landing screen
              // as soon as auth status flips to signedOut — no navigation here.
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
    t,
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: theme["--color-background"] }}>
      <AppHeader
        title={t("account.deleteAccount.title")}
        onBack={isSubmitting ? undefined : () => router.back()}
        backAccessibilityLabel={t("common.back")}
      />
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
              <Typography
                variant="caption"
                style={{ color: theme["--color-error"] }}
              >
                {errorMessage}
              </Typography>
            </View>
          ) : null}

          {reauthMode === "password" ? (
            <Input
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
            style={{
              marginTop: 8,
              backgroundColor: theme["--color-error"],
            }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
