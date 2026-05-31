// Global Account bottom sheet. Mounted once in the root layout and driven by
// useAccountSheetStore. The settings "Account" row opens it, and the hub's rows
// switch the active view in place — so the whole account flow surfaces as a
// paywall-style bottom sheet instead of pushing full-screen stack pages.

import { MAX_CONTENT_WIDTH } from "@/components/MaxWidthFrame";
import { AccountHubContent } from "@/components/account/AccountHubContent";
import { ChangeNameForm } from "@/components/account/ChangeNameForm";
import { ChangeEmailForm } from "@/components/account/ChangeEmailForm";
import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
import { DeleteAccountForm } from "@/components/account/DeleteAccountForm";
import { ResetPasswordForm } from "@/components/account/ResetPasswordForm";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import {
  type AccountSheetView,
  useAccountSheetStore,
} from "@/store/accountSheet";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
} from "@gorhom/bottom-sheet";
import { ArrowLeft, X } from "phosphor-react-native";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";

export function AccountSheet() {
  const { t } = useTranslation();
  const theme = useTheme();

  const isOpen = useAccountSheetStore((s) => s.isOpen);
  const view = useAccountSheetStore((s) => s.view);
  const busy = useAccountSheetStore((s) => s.busy);
  const close = useAccountSheetStore((s) => s.close);
  const navigate = useAccountSheetStore((s) => s.navigate);
  const setBusy = useAccountSheetStore((s) => s.setBusy);

  const sheetRef = useRef<BottomSheetModal>(null);
  // The hub is short; the forms are taller (and rise with the keyboard).
  const snapPoints = useMemo(
    () => (view === "hub" ? ["85%"] : ["92%"]),
    [view],
  );

  useEffect(() => {
    if (isOpen) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [isOpen]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.5}
        pressBehavior={busy ? "none" : "close"}
      />
    ),
    [busy],
  );

  const titles: Record<AccountSheetView, string> = {
    hub: t("account.title"),
    "change-name": t("account.changeName.title"),
    "change-email": t("account.changeEmail.title"),
    "change-password": t("account.changePassword.title"),
    "reset-password": t("account.resetPassword.title"),
    "delete-account": t("account.deleteAccount.title"),
  };

  const showBack = view !== "hub" && !busy;
  const showClose = !busy;

  const circleButton = ({ pressed }: { pressed: boolean }) => ({
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: pressed
      ? theme["--color-card-pressed"]
      : theme["--color-card-muted"],
  });

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose={!busy}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backdropComponent={renderBackdrop}
      onDismiss={close}
      backgroundStyle={{
        backgroundColor: theme["--color-background-secondary"],
        borderTopLeftRadius: 8,
        borderTopRightRadius: 8,
      }}
      handleIndicatorStyle={{
        width: 40,
        height: 4,
        borderRadius: 999,
        backgroundColor: theme["--color-border"],
      }}
    >
      {/* The sheet itself is full-width; on wide screens (iPad) constrain and
          center the content to the same column as the rest of the app. */}
      <View
        style={{
          flex: 1,
          width: "100%",
          maxWidth: MAX_CONTENT_WIDTH,
          alignSelf: "center",
        }}
      >
        {/* Header: back (non-hub) / title / close, each in a fixed-width slot
            so the title stays centered. */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingTop: 2,
            paddingBottom: 10,
            gap: 8,
          }}
        >
          <View style={{ width: 36, height: 36 }}>
            {showBack ? (
              <Pressable
                onPress={() => navigate("hub")}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("common.back")}
                style={circleButton}
              >
                <ArrowLeft
                  size={18}
                  weight="bold"
                  color={theme["--color-foreground"]}
                />
              </Pressable>
            ) : null}
          </View>
          <Typography
            variant="title-md"
            numberOfLines={1}
            style={{
              flex: 1,
              textAlign: "center",
              color: theme["--color-foreground"],
            }}
          >
            {titles[view]}
          </Typography>
          <View style={{ width: 36, height: 36 }}>
            {showClose ? (
              <Pressable
                onPress={close}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("common.close")}
                style={circleButton}
              >
                <X size={18} weight="bold" color={theme["--color-foreground"]} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {view === "hub" ? (
          <AccountHubContent onSelect={navigate} onClose={close} />
        ) : null}
        {view === "change-name" ? (
          <ChangeNameForm onDone={() => navigate("hub")} />
        ) : null}
        {view === "change-email" ? (
          <ChangeEmailForm onDone={() => navigate("hub")} />
        ) : null}
        {view === "change-password" ? (
          <ChangePasswordForm onDone={() => navigate("hub")} />
        ) : null}
        {view === "reset-password" ? <ResetPasswordForm /> : null}
        {view === "delete-account" ? (
          <DeleteAccountForm onBusyChange={setBusy} onDone={close} />
        ) : null}
      </View>
    </BottomSheetModal>
  );
}
