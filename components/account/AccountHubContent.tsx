import {
  AccountBody,
  ActionRow,
  IdentityCard,
  SectionHeader,
} from "@/components/account/parts";
import { type AccountSheetView } from "@/store/accountSheet";
import { useAuthStore } from "@/store/auth";
import { Envelope, Key, Lock, SignOut, Trash } from "phosphor-react-native";
import { useTranslation } from "react-i18next";
import { Alert, View } from "react-native";

// Account hub view — the identity card plus the credential/session/danger
// actions. Each row switches the sheet's active view in place (or fires an
// alert) instead of pushing a new screen.
export function AccountHubContent({
  onSelect,
  onClose,
}: {
  onSelect: (view: AccountSheetView) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const providers = useAuthStore((s) => s.providers);
  const signOut = useAuthStore((s) => s.signOut);
  const hasPasswordProvider = providers.some(
    (p) => p.providerId === "password",
  );

  const handleSignOut = () => {
    Alert.alert(
      t("account.signOut.confirmTitle"),
      t("account.signOut.confirmMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("account.signOut.confirmButton"),
          style: "destructive",
          onPress: () => {
            onClose();
            void signOut();
          },
        },
      ],
      { cancelable: true },
    );
  };

  return (
    <AccountBody>
      <IdentityCard />

      {/* Login & security — only meaningful for password accounts. Apple
          accounts have no app-managed password to rotate. */}
      {hasPasswordProvider ? (
        <View style={{ gap: 10 }}>
          <SectionHeader title={t("account.sections.loginSecurity")} />
          <ActionRow
            icon={Envelope}
            label={t("account.changeEmail.rowLabel")}
            onPress={() => onSelect("change-email")}
          />
          <ActionRow
            icon={Lock}
            label={t("account.changePassword.rowLabel")}
            onPress={() => onSelect("change-password")}
          />
          <ActionRow
            icon={Key}
            label={t("account.resetPassword.rowLabel")}
            onPress={() => onSelect("reset-password")}
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
          onPress={() => onSelect("delete-account")}
          danger
        />
      </View>
    </AccountBody>
  );
}
