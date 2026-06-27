// Shared building blocks for the Account bottom sheet views. Every view scrolls
// inside a BottomSheetScrollView (so scrolling coordinates with the sheet's pan
// gesture) and reuses the same cards/rows the old account stack pages used.

import { AppPressable } from "@/components/AppPressable";
import { Button } from "@/components/Button";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/auth";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { CaretRight, CheckCircle } from "phosphor-react-native";
import { Children, Fragment, type ReactNode } from "react";
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

// Groups a set of rows into a single card with hairline dividers between them —
// the iOS-Settings list look. Rows draw no card of their own; the group owns the
// surface, so a section reads as one clean block instead of a stack of chips.
export function RowGroup({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const items = Children.toArray(children).filter(Boolean);
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
      {items.map((child, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <View
              style={{
                height: 1,
                marginLeft: 16,
                backgroundColor: theme["--color-border"],
              }}
            />
          ) : null}
          {child}
        </Fragment>
      ))}
    </View>
  );
}

// A single text-forward row inside a RowGroup. No icon chip — just the label and
// a faint chevron. Press dims the row (scaling would clip against the group's
// rounded, overflow-hidden card).
export function ActionRow({
  label,
  onPress,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const theme = useTheme();

  return (
    <AppPressable
      onPress={onPress}
      accessibilityLabel={label}
      feedback="opacity"
      style={{
        paddingVertical: 16,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
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
        size={16}
        weight="bold"
        color={theme["--color-foreground-muted"]}
      />
    </AppPressable>
  );
}

// Identity card — the email / Apple ID and sign-in method, text-forward. We
// deliberately never surface a username or the raw Firebase uid. Verification is
// shown as a small colored dot + word rather than a bordered icon badge.
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
  const verifyColor = emailVerified
    ? theme["--color-success"]
    : theme["--color-warning"];

  return (
    <View
      style={{
        borderRadius: 16,
        backgroundColor: theme["--color-card"],
        borderWidth: 1,
        borderColor: theme["--color-border"],
        padding: 18,
        gap: 6,
      }}
    >
      <Typography
        variant="overline"
        style={{
          color: theme["--color-foreground-muted"],
          letterSpacing: 1,
        }}
      >
        {isAppleUser
          ? t("account.status.appleEmailLabel")
          : t("account.status.emailLabel")}
      </Typography>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Typography
          variant="title-md"
          numberOfLines={1}
          style={{ flex: 1, color: theme["--color-foreground"] }}
        >
          {email ?? t("account.status.emailHidden")}
        </Typography>
        {hasPasswordProvider ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                backgroundColor: verifyColor,
              }}
            />
            <Typography
              variant="caption"
              weight="semibold"
              style={{ color: verifyColor }}
            >
              {emailVerified
                ? t("account.status.verified")
                : t("account.status.pending")}
            </Typography>
          </View>
        ) : null}
      </View>

      {isAppleUser ? (
        <Typography
          variant="caption"
          style={{ color: theme["--color-foreground-muted"], marginTop: 2 }}
        >
          {t("account.status.appleManaged")}
        </Typography>
      ) : null}
    </View>
  );
}
