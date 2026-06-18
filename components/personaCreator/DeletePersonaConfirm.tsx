// Delete confirmation — a type-to-confirm dialog. Deletion is irreversible (the
// server drops the doc + its uploaded avatar), so the user must type the bot's
// name to arm the Delete action. Rendered as a native RN <Modal> so the dim
// backdrop covers the WHOLE window (not just the sheet's 80% bounds) and so it
// presents reliably above the @gorhom sheet on every platform. Because it lives
// outside the sheet's <SheetTouchableProvider>, its AppPressables use RN's
// Pressable — correct here, since inside a native Modal there's no sheet pan
// gesture to coordinate with.
//
// Flow: type the name → Delete lights up → tap → spinner → "Deleted" check →
// auto-close. The dialog cannot be dismissed once the delete is in flight or
// done (backdrop / Cancel / Android back are all inert until it closes itself).

import { AppPressable } from "@/components/AppPressable";
import { OverlayBackdrop, OverlayModal } from "@/components/OverlayModal";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { CheckCircle } from "phosphor-react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  View,
} from "react-native";

export function DeleteConfirm({
  open,
  names,
  deleting,
  deleted,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  // Display names of the marked bots. Length 1 is the common case (type the
  // name); length >1 falls back to typing a fixed keyword.
  names: string[];
  deleting: boolean;
  deleted: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [text, setText] = useState("");

  const single = names.length === 1;
  const count = names.length;
  // What the user must type. The single-bot name, or a fixed keyword for a
  // multi-select batch (no single name to echo).
  const confirmWord = t("personas.select.confirmWord");
  const target = single ? names[0] : confirmWord;
  const locked = deleting || deleted; // no dismiss / no edits once it's running

  // Reset the typed text whenever the dialog (re)opens, so a prior attempt never
  // pre-arms the next one.
  useEffect(() => {
    if (open) setText("");
  }, [open]);

  const matched = text.trim().toLowerCase() === target.trim().toLowerCase();
  const armed = matched && !locked;

  const title = single
    ? t("personas.select.deleteTitleOne", { name: names[0] })
    : t("personas.select.deleteMany", { count });
  const hint = single
    ? t("personas.select.confirmHint", { name: names[0] })
    : t("personas.select.confirmHintMany", { word: confirmWord });

  return (
    <OverlayModal
      visible={open}
      animationType="fade"
      // Android hardware back: cancel only when idle; never while running.
      onRequestClose={locked ? () => {} : onCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        {/* Full-window dim — tap to cancel, but inert once locked. */}
        <OverlayBackdrop
          onPress={locked ? undefined : onCancel}
          accessibilityLabel={t("common.cancel")}
        />

        <View
          pointerEvents="box-none"
          style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24 }}
        >
          <View
            style={{
              backgroundColor: theme["--color-card"],
              borderRadius: 20,
              padding: 22,
              gap: 12,
            }}
          >
            {deleted ? (
              // Success confirmation, shown briefly before the modal closes.
              <View
                style={{ alignItems: "center", gap: 12, paddingVertical: 8 }}
              >
                <CheckCircle
                  size={44}
                  weight="fill"
                  color={theme["--color-success"]}
                />
                <Typography
                  variant="title-md"
                  style={{
                    color: theme["--color-foreground"],
                    fontWeight: "800",
                  }}
                >
                  {t("personas.select.deleted")}
                </Typography>
              </View>
            ) : (
              <>
                <Typography
                  variant="title-md"
                  style={{
                    color: theme["--color-foreground"],
                    fontWeight: "800",
                  }}
                  numberOfLines={2}
                >
                  {title}
                </Typography>
                <Typography
                  variant="body"
                  style={{ color: theme["--color-foreground-secondary"] }}
                >
                  {hint}
                </Typography>

                <TextInput
                  value={text}
                  onChangeText={setText}
                  editable={!locked}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={target}
                  placeholderTextColor={theme["--color-foreground-muted"]}
                  accessibilityLabel={t("personas.select.confirmInputA11y")}
                  style={{
                    marginTop: 2,
                    paddingHorizontal: 14,
                    paddingVertical: 11,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: matched
                      ? theme["--color-error"]
                      : theme["--color-border"],
                    backgroundColor: theme["--color-card-muted"],
                    color: theme["--color-foreground"],
                    fontSize: 16,
                  }}
                />

                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "flex-end",
                    gap: 12,
                    marginTop: 4,
                  }}
                >
                  <AppPressable
                    onPress={onCancel}
                    disabled={locked}
                    feedback="opacity"
                    accessibilityLabel={t("common.cancel")}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderRadius: 10,
                    }}
                  >
                    <Typography
                      variant="body"
                      style={{
                        color: theme["--color-foreground-muted"],
                        fontWeight: "600",
                      }}
                    >
                      {t("common.cancel")}
                    </Typography>
                  </AppPressable>
                  <AppPressable
                    onPress={onConfirm}
                    disabled={!armed}
                    haptic
                    feedback="opacity"
                    accessibilityState={{ disabled: !armed, busy: deleting }}
                    accessibilityLabel={t("common.delete")}
                    style={{
                      minWidth: 100,
                      alignItems: "center",
                      justifyContent: "center",
                      paddingHorizontal: 16,
                      paddingVertical: 10,
                      borderRadius: 10,
                      // Lights up only once the name matches; dim + inert before.
                      backgroundColor: armed
                        ? theme["--color-error"]
                        : theme["--color-error-muted"],
                      opacity: matched || deleting ? 1 : 0.6,
                    }}
                  >
                    {deleting ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Typography
                        variant="body"
                        style={{
                          color: armed ? "#FFFFFF" : theme["--color-error"],
                          fontWeight: "800",
                        }}
                      >
                        {t("common.delete")}
                      </Typography>
                    )}
                  </AppPressable>
                </View>
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </OverlayModal>
  );
}
