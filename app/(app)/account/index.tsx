import { AppHeader } from "@/components/AppHeader";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/auth";
import { useRouter } from "expo-router";
import {
  AppleLogo,
  CaretRight,
  CheckCircle,
  Envelope,
  Key,
  Lock,
  SignOut,
  Trash,
  WarningCircle,
  type IconProps,
} from "phosphor-react-native";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, ScrollView, View } from "react-native";

// Dedicated account-management hub. Settings links here so the settings page
// stays short; everything that touches the user's credentials or session lives
// on this screen and its sub-routes. We deliberately never surface a username
// or the raw Firebase uid — the only identity shown is the email / Apple ID and
// how the account was created.
export default function AccountScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const email = useAuthStore((s) => s.email);
  const emailVerified = useAuthStore((s) => s.emailVerified);
  const providers = useAuthStore((s) => s.providers);
  const signOut = useAuthStore((s) => s.signOut);

  const isAppleUser = providers.some((p) => p.providerId === "apple.com");
  const hasPasswordProvider = providers.some(
    (p) => p.providerId === "password",
  );

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  };

  const handleSignOut = () => {
    Alert.alert(
      t("account.signOut.confirmTitle"),
      t("account.signOut.confirmMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("account.signOut.confirmButton"),
          style: "destructive",
          onPress: () => void signOut(),
        },
      ],
      { cancelable: true },
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme["--color-background"] }}>
      <AppHeader
        title={t("account.title")}
        onBack={handleBack}
        backAccessibilityLabel={t("common.back")}
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 24,
          paddingBottom: 48,
          gap: 20,
        }}
      >
        {/* Identity card — sign-in method + the email / Apple ID. */}
        <View
          style={{
            borderRadius: 16,
            backgroundColor: theme["--color-card"],
            borderWidth: 1,
            borderColor: theme["--color-border"],
            overflow: "hidden",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              padding: 16,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme["--color-primary-muted"],
              }}
            >
              {isAppleUser ? (
                <AppleLogo
                  size={22}
                  weight="fill"
                  color={theme["--color-primary"]}
                />
              ) : (
                <Envelope
                  size={22}
                  weight="bold"
                  color={theme["--color-primary"]}
                />
              )}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Typography
                variant="caption"
                style={{ color: theme["--color-foreground-secondary"] }}
              >
                {t("account.status.methodLabel")}
              </Typography>
              <Typography
                variant="body"
                weight="semibold"
                style={{ color: theme["--color-foreground"] }}
              >
                {isAppleUser
                  ? t("account.status.methodApple")
                  : t("account.status.methodPassword")}
              </Typography>
            </View>
          </View>

          <View
            style={{
              height: 1,
              backgroundColor: theme["--color-border"],
              marginHorizontal: 16,
            }}
          />

          <View style={{ padding: 16, gap: 4 }}>
            <Typography
              variant="caption"
              style={{ color: theme["--color-foreground-secondary"] }}
            >
              {isAppleUser
                ? t("account.status.appleEmailLabel")
                : t("account.status.emailLabel")}
            </Typography>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Typography
                variant="body"
                weight="semibold"
                numberOfLines={1}
                style={{ flex: 1, color: theme["--color-foreground"] }}
              >
                {email ?? t("account.status.emailHidden")}
              </Typography>
              {hasPasswordProvider ? (
                <VerificationBadge verified={emailVerified} />
              ) : null}
            </View>
            {isAppleUser ? (
              <Typography
                variant="caption"
                style={{
                  color: theme["--color-foreground-muted"],
                  marginTop: 4,
                }}
              >
                {t("account.status.appleManaged")}
              </Typography>
            ) : null}
          </View>
        </View>

        {/* Login & security — only meaningful for password accounts. Apple
            accounts have no app-managed password to rotate. */}
        {hasPasswordProvider ? (
          <View style={{ gap: 10 }}>
            <SectionHeader title={t("account.sections.loginSecurity")} />
            <ActionRow
              icon={Envelope}
              label={t("account.changeEmail.rowLabel")}
              onPress={() => router.push("/account/change-email")}
            />
            <ActionRow
              icon={Lock}
              label={t("account.changePassword.rowLabel")}
              onPress={() => router.push("/account/change-password")}
            />
            <ActionRow
              icon={Key}
              label={t("account.resetPassword.rowLabel")}
              onPress={() => router.push("/account/reset-password")}
            />
          </View>
        ) : null}

        {/* Session */}
        <View style={{ gap: 10 }}>
          <SectionHeader title={t("account.sections.session")} />
          <ActionRow
            icon={SignOut}
            label={t("account.signOut.rowLabel")}
            onPress={handleSignOut}
          />
        </View>

        {/* Danger zone */}
        <View style={{ gap: 10 }}>
          <SectionHeader title={t("account.sections.dangerZone")} />
          <ActionRow
            icon={Trash}
            label={t("account.deleteAccount.rowLabel")}
            onPress={() => router.push("/account/delete-account")}
            danger
          />
        </View>
      </ScrollView>
    </View>
  );
}

function VerificationBadge({ verified }: { verified: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const color = verified ? theme["--color-success"] : theme["--color-warning"];

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: color,
      }}
    >
      {verified ? (
        <CheckCircle size={12} weight="fill" color={color} />
      ) : (
        <WarningCircle size={12} weight="fill" color={color} />
      )}
      <Typography variant="micro" style={{ color }}>
        {verified
          ? t("account.status.verified")
          : t("account.status.pending")}
      </Typography>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <Typography
      variant="overline"
      style={{
        color: theme["--color-foreground-muted"],
        letterSpacing: 1,
        marginLeft: 4,
      }}
    >
      {title}
    </Typography>
  );
}

function ActionRow({
  icon: Icon,
  label,
  onPress,
  danger = false,
}: {
  icon: ComponentType<IconProps>;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const theme = useTheme();
  const accent = danger ? theme["--color-error"] : theme["--color-primary"];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        borderRadius: 16,
        backgroundColor: pressed
          ? theme["--color-card-pressed"]
          : theme["--color-card"],
        borderWidth: 1,
        borderColor: danger ? theme["--color-error"] : theme["--color-border"],
        paddingVertical: 14,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: danger
            ? theme["--color-error-muted"]
            : theme["--color-primary-muted"],
        }}
      >
        <Icon size={20} weight="bold" color={accent} />
      </View>
      <Typography
        variant="body"
        weight="semibold"
        style={{
          flex: 1,
          color: danger ? theme["--color-error"] : theme["--color-foreground"],
        }}
      >
        {label}
      </Typography>
      <CaretRight
        size={18}
        weight="bold"
        color={theme["--color-foreground-muted"]}
      />
    </Pressable>
  );
}
