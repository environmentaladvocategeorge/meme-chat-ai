// NameSheet
//
// The "Nickname" editor — a compact bottom sheet for setting what the bot calls
// you. It used to be a view inside the Account sheet, but a nickname is a
// personalization preference, not an account/security concern, so it now opens
// from Settings → Preferences via useNameSheetStore.
//
// On save the sheet shows a soft animated confirmation (a check that springs in
// with the new name) and auto-dismisses, rather than parking on a success screen
// with a Done button. The save button itself shows an inline spinner while the
// profile callable is in flight.
//
// Mounted once at the root layout (outside the iPad content column) so the sheet
// spans the full screen width and stays centered on wide screens.

import { SheetTouchableProvider } from "@/components/AppPressable";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { MAX_CONTENT_WIDTH } from "@/components/MaxWidthFrame";
import { SheetBackdrop } from "@/components/SheetBackdrop";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { updateProfileCallable } from "@/services/firebase/callables";
import { useNameSheetStore } from "@/store/nameSheet";
import { useSettingsStore } from "@/store/settings";
import { MAX_ALIAS_LENGTH } from "@/store/storage";
import {
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { Check, Smiley } from "phosphor-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  FadeIn,
  useReducedMotion,
  ZoomIn,
} from "react-native-reanimated";

// How long the confirmation lingers before the sheet dismisses itself.
const CONFIRM_DISMISS_MS = 1300;

export function NameSheet() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const isOpen = useNameSheetStore((s) => s.isOpen);
  const close = useNameSheetStore((s) => s.close);
  const storedAlias = useSettingsStore((s) => s.alias);
  const setAlias = useSettingsStore((s) => s.setAlias);

  const sheetRef = useRef<BottomSheetModal>(null);

  const [draft, setDraft] = useState(storedAlias);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The saved name we're confirming. null = still editing; a string (possibly
  // empty, for a cleared nickname) = show the confirmation state.
  const [savedName, setSavedName] = useState<string | null>(null);

  const trimmed = draft.trim().slice(0, MAX_ALIAS_LENGTH);
  const unchanged = trimmed === storedAlias.trim();

  useEffect(() => {
    if (isOpen) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [isOpen]);

  // Reset the editing state to the freshest stored value every time the sheet
  // opens, so a re-open never shows a stale draft or a lingering confirmation.
  useEffect(() => {
    if (isOpen) {
      setDraft(storedAlias);
      setError(null);
      setSavedName(null);
      setSubmitting(false);
    }
  }, [isOpen, storedAlias]);

  // Once the confirmation is showing, auto-dismiss after a beat.
  useEffect(() => {
    if (savedName === null) return;
    const id = setTimeout(() => close(), CONFIRM_DISMISS_MS);
    return () => clearTimeout(id);
  }, [savedName, close]);

  const handleSave = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await updateProfileCallable({ alias: trimmed });
      setAlias(trimmed);
      setSavedName(trimmed);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("hate_speech_detected")) {
        setError(t("account.changeName.hateSpeechError"));
      } else {
        setError(t("account.changeName.error"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <SheetBackdrop {...props} opacity={0.5} enabled={!submitting} />
    ),
    [submitting],
  );

  const confirming = savedName !== null;

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      enablePanDownToClose={!submitting}
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
        backgroundColor: theme["--color-foreground-muted"],
      }}
    >
      <BottomSheetView
        style={{
          width: "100%",
          maxWidth: MAX_CONTENT_WIDTH,
          alignSelf: "center",
          paddingHorizontal: 24,
          paddingTop: 4,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <SheetTouchableProvider>
          {/* Header — left-aligned icon + title, matching the other settings
              sheets (Language, Memory, Rot Level). Dismiss is via pan-down or
              the backdrop, so there's no close button. */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingTop: 2,
              paddingBottom: 16,
            }}
          >
            <Smiley size={24} weight="bold" color={theme["--color-foreground"]} />
            <Typography
              variant="title-lg"
              numberOfLines={1}
              style={{ flex: 1, color: theme["--color-foreground"] }}
            >
              {t("account.changeName.title")}
            </Typography>
          </View>

          {confirming ? (
            <ConfirmationView name={savedName ?? ""} reduceMotion={reduceMotion} />
          ) : (
            // No opacity entrance here: it wraps the glass Input, and opacity 0
            // on a glass ancestor blanks the native material (expo-glass-effect
            // bug). See GlassSurface's opacity-0 note.
            <View style={{ gap: 16 }}>
              <Input
                bottomSheet
                label={t("account.changeName.inputLabel")}
                placeholder={t("account.changeName.placeholder")}
                value={draft}
                onChangeText={setDraft}
                maxLength={MAX_ALIAS_LENGTH}
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (!submitting && !unchanged) void handleSave();
                }}
                autoFocus
              />
              {error ? (
                <View
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: theme["--color-error"],
                    backgroundColor: theme["--color-error-muted"],
                  }}
                >
                  <Typography
                    variant="caption"
                    style={{ color: theme["--color-error"] }}
                  >
                    {error}
                  </Typography>
                </View>
              ) : null}
              <Button
                title={t("account.changeName.save")}
                onPress={handleSave}
                loading={submitting}
                disabled={submitting || unchanged}
              />
            </View>
          )}
        </SheetTouchableProvider>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

// The post-save confirmation: a check that springs in over a soft tinted disc,
// with the freshly-saved name (or a "cleared" line). No button — the sheet
// dismisses itself after a beat.
function ConfirmationView({
  name,
  reduceMotion,
}: {
  name: string;
  reduceMotion: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(180)}
      style={{ alignItems: "center", gap: 14, paddingVertical: 12 }}
    >
      <Animated.View
        entering={reduceMotion ? undefined : ZoomIn.springify().damping(13)}
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: theme["--color-success-muted"],
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Check size={36} weight="bold" color={theme["--color-success"]} />
      </Animated.View>
      <Typography
        variant="title-md"
        style={{ color: theme["--color-foreground"], textAlign: "center" }}
      >
        {t("account.changeName.successTitle")}
      </Typography>
      <Typography
        variant="body"
        style={{
          color: theme["--color-foreground-secondary"],
          textAlign: "center",
          maxWidth: 300,
        }}
      >
        {name.length > 0
          ? t("account.changeName.successBody", { name })
          : t("account.changeName.successBodyCleared")}
      </Typography>
    </Animated.View>
  );
}
