// Persona creator — a full-height page (not a sheet). Each wizard step asks for
// a different amount, so a fixed-height sheet either cramped the long steps
// (voice + advanced, reactions picker) or wasted space on the short ones. A page
// gives every step the same stable frame: header (step dots + X), a scrolling
// body, and a footer that lifts above the keyboard.
//
// Interaction model is unchanged from the old sheet: there is NO autosave and NO
// swipe-away. The only way out is the top-right X, which opens a small menu —
// Save draft or Discard — so unsaved work can't be dropped by accident. Back/Next
// live in the footer; Next becomes "Save bot" on the last step.

import { AppPressable } from "@/components/AppPressable";
import { GlassSurface } from "@/components/GlassSurface";
import { IconButton } from "@/components/IconButton";
import { StepBody } from "@/components/personaCreator/steps";
import { Typography } from "@/components/Typography";
import {
  EMPTY_PERSONA_FORM,
  PERSONA_STEP_FIELDS,
  PERSONA_STEPS,
  personaFormResolver,
  type PersonaFormValues,
} from "@/domain/personaForm";
import { publishPersonaDraft } from "@/domain/publishPersona";
import { useTheme } from "@/hooks/useTheme";
import { savePersonaCallable } from "@/services/firebase/callables";
import { uploadPendingAvatar } from "@/services/firebase/uploadPersonaAvatar";
import { useAuthStore } from "@/store/auth";
import { useActiveDraft, usePersonaDraftStore } from "@/store/personaDraft";
import { usePersonaStore } from "@/store/personas";
import { useRouter } from "expo-router";
import { CaretLeft, FloppyDisk, Trash, X } from "phosphor-react-native";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { FormProvider, useForm, type Resolver } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

export default function PersonaCreatorScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const draft = useActiveDraft();

  const methods = useForm<PersonaFormValues>({
    defaultValues: draft?.values ?? EMPTY_PERSONA_FORM,
    resolver: personaFormResolver as unknown as Resolver<PersonaFormValues>,
    mode: "onTouched",
  });

  const [stepIndex, setStepIndex] = useState(draft?.step ?? 0);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [exitMenuOpen, setExitMenuOpen] = useState(false);
  const uid = useAuthStore((s) => s.uid);

  // Set true the instant we begin an intentional exit (save/discard/publish), so
  // the "draft went null → bail out" guard below doesn't also try to navigate
  // and over-pop the stack.
  const leaving = useRef(false);
  const leave = useCallback(() => {
    leaving.current = true;
    router.back();
  }, [router]);

  // Direct-navigation safety: a creator with no active draft is an impossible
  // state from the picker (which always seeds one), but if we somehow land here
  // without a draft, return to where we came from instead of showing a blank.
  useEffect(() => {
    if (!draft && !leaving.current) router.back();
  }, [draft, router]);

  // Hardware back (Android) and any back intent route through the X menu — never
  // a silent pop — so unsaved work always gets the Save/Discard choice.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setExitMenuOpen((open) => !open);
      return true;
    });
    return () => sub.remove();
  }, []);

  const step = PERSONA_STEPS[stepIndex];
  const isLast = stepIndex === PERSONA_STEPS.length - 1;

  const goNext = useCallback(async () => {
    const fields = PERSONA_STEP_FIELDS[step];
    const ok = fields.length === 0 ? true : await methods.trigger(fields);
    if (ok && !isLast) setStepIndex((i) => i + 1);
  }, [step, isLast, methods]);

  // Back goes one step; on the first step there's nowhere to go (no template
  // picker), so the button is disabled and the X menu is the only way out.
  const onBack = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const canGoBack = stepIndex > 0;

  // Flush the on-screen form values + step into the active draft (in memory).
  // There's no autosave, so this runs only right before an explicit save or a
  // publish.
  const flush = useCallback(() => {
    usePersonaDraftStore.getState().updateActive({
      values: methods.getValues(),
      step: stepIndex,
    });
  }, [methods, stepIndex]);

  const handleSaveDraft = useCallback(async () => {
    leaving.current = true;
    flush();
    await usePersonaDraftStore.getState().saveNow();
    usePersonaDraftStore.getState().closeActive();
    setExitMenuOpen(false);
    leave();
  }, [flush, leave]);

  const handleDiscard = useCallback(() => {
    // Discard = throw it away (the red option): delete the draft from memory +
    // disk, saved or not.
    leaving.current = true;
    const id = usePersonaDraftStore.getState().activeId;
    if (id) usePersonaDraftStore.getState().discard(id);
    setExitMenuOpen(false);
    leave();
  }, [leave]);

  // Publish: validate, flush, upload the avatar (if any), call savePersona
  // (which moderates + renders), then on success drop the draft, refresh the
  // persona list, select the new persona, and leave. Failures keep the page open
  // with a soft message.
  const handlePublish = useCallback(async () => {
    if (publishing) return;
    setPublishError(null);
    const ok = await methods.trigger();
    if (!ok) {
      setPublishError(t("personasCreator.error.incomplete"));
      return;
    }
    flush();
    const state = usePersonaDraftStore.getState();
    const activeDraft = state.drafts.find((d) => d.id === state.activeId);
    if (!activeDraft) return;

    setPublishing(true);
    try {
      const result = await publishPersonaDraft(activeDraft, {
        uploadAvatar: uploadPendingAvatar,
        savePersona: async (args) => {
          const res = await savePersonaCallable(args);
          return { personaId: res.personaId };
        },
      });
      if (result.ok) {
        leaving.current = true;
        usePersonaDraftStore.getState().discard(activeDraft.id);
        if (uid) await usePersonaStore.getState().hydrate(uid);
        usePersonaStore.getState().select(result.personaId);
        leave();
        return;
      }
      setPublishError(t(`personasCreator.publishError.${result.reason}`));
    } finally {
      setPublishing(false);
    }
  }, [publishing, methods, flush, uid, leave, t]);

  if (!draft) return null;

  return (
    <FormProvider {...methods}>
      <View style={{ flex: 1, backgroundColor: theme["--color-background"] }}>
        <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ flex: 1 }}
          >
            {/* Header: step dots (center) · X exit (right). Back lives in the
                footer; the left slot is a spacer to keep the dots centered. */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 16,
                paddingTop: 8,
                paddingBottom: 8,
                gap: 8,
              }}
            >
              <View style={{ width: 36, height: 36 }} />

              <View
                style={{ flex: 1, flexDirection: "row", justifyContent: "center", gap: 6 }}
              >
                {PERSONA_STEPS.map((s, i) => (
                  <View
                    key={s}
                    style={{
                      width: i === stepIndex ? 20 : 7,
                      height: 7,
                      borderRadius: 999,
                      backgroundColor:
                        i === stepIndex
                          ? theme["--color-primary"]
                          : theme["--color-border-strong"],
                    }}
                  />
                ))}
              </View>

              <IconButton
                onPress={() => setExitMenuOpen(true)}
                hitSlop={8}
                size={36}
                glass
                fallbackStyle={{ backgroundColor: theme["--color-card-muted"] }}
                accessibilityLabel={t("common.close")}
              >
                <X size={18} weight="bold" color={theme["--color-foreground"]} />
              </IconButton>
            </View>

            {/* One step at a time (no measured pager → no first-paint flash). The
                key resets scroll position between steps; inputs keep their values
                from the form context. */}
            <ScrollView
              key={step}
              style={{ flex: 1 }}
              contentContainerStyle={{
                paddingHorizontal: 20,
                paddingTop: 8,
                paddingBottom: 24,
                gap: 16,
              }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            >
              <StepBody step={step} />
            </ScrollView>

            {/* Footer: Back (left) and Next / Save bot (right), split 50/50. Rides
                up above the keyboard via the KeyboardAvoidingView padding. */}
            <View
              style={{
                paddingHorizontal: 16,
                paddingBottom: 8,
                paddingTop: 8,
                gap: 8,
              }}
            >
              {publishError ? (
                <Typography
                  variant="caption"
                  style={{ color: theme["--color-error"], textAlign: "center" }}
                >
                  {publishError}
                </Typography>
              ) : null}
              <View style={{ flexDirection: "row", gap: 12 }}>
                <AppPressable
                  onPress={onBack}
                  disabled={!canGoBack}
                  accessibilityLabel={t("common.back")}
                  pressScale={0.04}
                  containerStyle={{ flex: 1 }}
                  style={{
                    flexDirection: "row",
                    gap: 6,
                    paddingVertical: 14,
                    borderRadius: 16,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme["--color-card"],
                    borderWidth: 1,
                    borderColor: theme["--color-border"],
                    opacity: canGoBack ? 1 : 0.4,
                  }}
                >
                  <CaretLeft size={16} weight="bold" color={theme["--color-foreground"]} />
                  <Typography
                    variant="body"
                    weight="semibold"
                    style={{ color: theme["--color-foreground"] }}
                  >
                    {t("common.back")}
                  </Typography>
                </AppPressable>

                <AppPressable
                  onPress={isLast ? handlePublish : goNext}
                  disabled={publishing}
                  accessibilityLabel={
                    isLast ? t("personasCreator.publish") : t("personasCreator.next")
                  }
                  pressScale={0.04}
                  containerStyle={{ flex: 1 }}
                  style={{
                    paddingVertical: 14,
                    borderRadius: 16,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme["--color-primary"],
                  }}
                >
                  {publishing ? (
                    <ActivityIndicator size="small" color={theme["--color-primary-foreground"]} />
                  ) : (
                    <Typography
                      variant="body"
                      weight="semibold"
                      style={{ color: theme["--color-primary-foreground"] }}
                    >
                      {isLast ? t("personasCreator.publish") : t("personasCreator.next")}
                    </Typography>
                  )}
                </AppPressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>

        <ExitMenu
          open={exitMenuOpen}
          onClose={() => setExitMenuOpen(false)}
          onSaveDraft={handleSaveDraft}
          onDiscard={handleDiscard}
        />
      </View>
    </FormProvider>
  );
}

// ── Exit menu (the X popover: Save draft / Discard) ───────────────────────────

function ExitMenu({
  open,
  onClose,
  onSaveDraft,
  onDiscard,
}: {
  open: boolean;
  onClose: () => void;
  onSaveDraft: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(false);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (open) {
      setMounted(true);
      progress.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) });
    } else if (mounted) {
      progress.value = withTiming(
        0,
        { duration: 140, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(setMounted)(false);
        },
      );
    }
  }, [open, mounted, progress]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.4 }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [-8, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.94, 1]) },
    ],
  }));

  if (!mounted) return null;

  return (
    <View pointerEvents={open ? "auto" : "none"} style={StyleSheet.absoluteFillObject}>
      <AppPressable
        onPress={onClose}
        feedback="none"
        hitSlop={0}
        accessibilityLabel={t("common.close")}
        containerStyle={StyleSheet.absoluteFillObject}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: theme["--color-overlay"] },
            backdropStyle,
          ]}
        />
      </AppPressable>

      {/* Anchored just under the header's X button (which sits at the top of the
          safe-area inset + the header's 8px pad + 36px button). */}
      <Animated.View
        style={[
          {
            position: "absolute",
            top: insets.top + 44,
            right: 16,
            minWidth: 220,
            transformOrigin: "top right",
          },
          panelStyle,
        ]}
      >
        <GlassSurface
          style={{ borderRadius: 18, overflow: "hidden" }}
          fallbackStyle={{
            backgroundColor: theme["--color-card"],
            borderWidth: 1,
            borderColor: theme["--color-border"],
          }}
        >
          <Typography
            variant="caption"
            weight="semibold"
            style={{
              color: theme["--color-foreground-muted"],
              paddingHorizontal: 16,
              paddingTop: 14,
              paddingBottom: 6,
            }}
          >
            {t("personasCreator.exitTitle")}
          </Typography>
          <ExitRow
            icon={<FloppyDisk size={18} weight="bold" color={theme["--color-foreground"]} />}
            label={t("personasCreator.saveDraft")}
            color={theme["--color-foreground"]}
            onPress={onSaveDraft}
          />
          <View
            style={{
              height: StyleSheet.hairlineWidth,
              backgroundColor: theme["--color-border"],
              marginHorizontal: 16,
            }}
          />
          <ExitRow
            icon={<Trash size={18} weight="bold" color={theme["--color-error"]} />}
            label={t("personasCreator.discardDraft")}
            color={theme["--color-error"]}
            onPress={onDiscard}
          />
        </GlassSurface>
      </Animated.View>
    </View>
  );
}

function ExitRow({
  icon,
  label,
  color,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <AppPressable
      onPress={onPress}
      accessibilityLabel={label}
      pressScale={0.02}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
      }}
    >
      {icon}
      <Typography variant="body" weight="semibold" style={{ color }}>
        {label}
      </Typography>
    </AppPressable>
  );
}
