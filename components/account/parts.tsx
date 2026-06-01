// Shared building blocks for the Account bottom sheet views. Every view scrolls
// inside a BottomSheetScrollView (so scrolling coordinates with the sheet's pan
// gesture) and reuses the same cards/rows the old account stack pages used.

import { AppPressable } from "@/components/AppPressable";
import { Button } from "@/components/Button";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/auth";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import {
  AppleLogo,
  CaretRight,
  CheckCircle,
  Envelope,
  WarningCircle,
  type IconProps,
} from "phosphor-react-native";
import { type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Scrollable body shared by every account view inside the sheet.
export function AccountBody({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <BottomSheetScrollView
      style={{ flex: 1 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: 24,
        paddingTop: 8,
        paddingBottom: insets.bottom + 24,
        gap: 16,
      }}
    >
      {children}
    </BottomSheetScrollView>
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
    <View style={{ alignItems: "center", gap: 16, paddingVertical: 24 }}>
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
        <CheckCircle size={34} weight="fill" color={theme["--color-success"]} />
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

export function SectionHeader({ title }: { title: string }) {
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

export function ActionRow({
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
    <AppPressable
      onPress={onPress}
      accessibilityLabel={label}
      pressScale={0.02}
      style={{
        borderRadius: 16,
        backgroundColor: theme["--color-card"],
        borderWidth: 1,
        borderColor: danger ? theme["--color-error"] : theme["--color-border"],
        paddingVertical: 14,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
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
    </AppPressable>
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
        {verified ? t("account.status.verified") : t("account.status.pending")}
      </Typography>
    </View>
  );
}

// Identity card — sign-in method + the email / Apple ID. We deliberately never
// surface a username or the raw Firebase uid.
export function IdentityCard() {
  const { t } = useTranslation();
  const theme = useTheme();
  const email = useAuthStore((s) => s.email);
  const emailVerified = useAuthStore((s) => s.emailVerified);
  const providers = useAuthStore((s) => s.providers);
  const isAppleUser = providers.some((p) => p.providerId === "apple.com");
  const hasPasswordProvider = providers.some(
    (p) => p.providerId === "password",
  );

  return (
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
            <AppleLogo size={22} weight="fill" color={theme["--color-primary"]} />
          ) : (
            <Envelope size={22} weight="bold" color={theme["--color-primary"]} />
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
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
            style={{ color: theme["--color-foreground-muted"], marginTop: 4 }}
          >
            {t("account.status.appleManaged")}
          </Typography>
        ) : null}
      </View>
    </View>
  );
}
