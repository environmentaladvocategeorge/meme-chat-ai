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
import {
  CreatorSessionProvider,
  DraftCreatorSession,
  type CreatorSession,
  type SessionAvatar,
} from "@/components/personaCreator/CreatorSession";
import { StepBody } from "@/components/personaCreator/steps";
import { Typography } from "@/components/Typography";
import type { MediaPick } from "@/domain/personaDrafts";
import {
  EMPTY_PERSONA_FORM,
  PERSONA_STEP_FIELDS,
  PERSONA_STEPS,
  personaFormResolver,
  type PersonaFormValues,
} from "@/domain/personaForm";
import { publishPersonaDraft } from "@/domain/publishPersona";
import { savePersonaEdit, type EditAvatarState } from "@/domain/savePersonaEdit";
import { useTheme } from "@/hooks/useTheme";
import { fetchPersonaInput } from "@/services/firebase/personas";
import { savePersonaCallable } from "@/services/firebase/callables";
import { uploadPendingAvatar } from "@/services/firebase/uploadPersonaAvatar";
import { useAuthStore } from "@/store/auth";
import { useActiveDraft, usePersonaDraftStore } from "@/store/personaDraft";
import { usePersonaStore } from "@/store/personas";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CaretLeft, FloppyDisk, Trash, X } from "phosphor-react-native";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FormProvider, useForm, type Resolver } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
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

  // EDIT mode is keyed by a ?personaId route param: there's no draft, the form
  // is seeded from the stored persona, and the only exits are "save changes" or
  // "quit and lose changes" (no draft autosave).
  const params = useLocalSearchParams<{ personaId?: string }>();
  const editPersonaId =
    typeof params.personaId === "string" && params.personaId.length > 0
      ? params.personaId
      : null;
  const isEdit = editPersonaId !== null;

  const methods = useForm<PersonaFormValues>({
    // Edit seeds via reset() once the fetch lands (below); start empty so the
    // isDirty baseline is set by that reset, not a stale default.
    defaultValues: isEdit ? EMPTY_PERSONA_FORM : draft?.values ?? EMPTY_PERSONA_FORM,
    resolver: personaFormResolver as unknown as Resolver<PersonaFormValues>,
    mode: "onTouched",
  });

  const [stepIndex, setStepIndex] = useState(isEdit ? 0 : draft?.step ?? 0);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [exitMenuOpen, setExitMenuOpen] = useState(false);
  const uid = useAuthStore((s) => s.uid);

  // Edit-session state (avatar + reaction picks live outside react-hook-form).
  // Held on the screen so dirty-tracking and the save call can read them.
  const [editLoad, setEditLoad] = useState<"loading" | "ready" | "error">(
    isEdit ? "loading" : "ready",
  );
  const [editAvatar, setEditAvatar] = useState<SessionAvatar>({ kind: "none" });
  const [editMediaPicks, setEditMediaPicks] = useState<MediaPick[]>([]);
  const [initialAvatarUrl, setInitialAvatarUrl] = useState<string | null>(null);

  // The avatar changed relative to the loaded persona (new local image, or the
  // existing one was removed). The form's isDirty covers every other field
  // (including mediaPills, which ReactionPicker writes), so this is the only
  // extra signal the dirty gate needs.
  const avatarChanged =
    editAvatar.kind === "local" ||
    (editAvatar.kind === "none" && initialAvatarUrl !== null);
  const dirty = isEdit ? methods.formState.isDirty || avatarChanged : true;

  const editSession = useMemo<CreatorSession>(
    () => ({
      avatar: editAvatar,
      setLocalAvatar: (a) => setEditAvatar({ kind: "local", ...a }),
      removeAvatar: () => setEditAvatar({ kind: "none" }),
      mediaPicks: editMediaPicks,
      setMediaPicks: setEditMediaPicks,
      isEdit: true,
    }),
    [editAvatar, editMediaPicks],
  );

  // Set true the instant we begin an intentional exit (save/discard/publish), so
  // the "draft went null → bail out" guard below doesn't also try to navigate
  // and over-pop the stack.
  const leaving = useRef(false);
  const leave = useCallback(() => {
    leaving.current = true;
    router.back();
  }, [router]);

  // Direct-navigation safety (CREATE only): a creator with no active draft is an
  // impossible state from the picker (which always seeds one), but if we somehow
  // land here without a draft, return instead of showing a blank. Edit mode has
  // no draft by design, so it's exempt.
  useEffect(() => {
    if (!isEdit && !draft && !leaving.current) router.back();
  }, [isEdit, draft, router]);

  // Edit mode: load the stored persona once, seed the form (reset establishes
  // the isDirty baseline), and hydrate the avatar + reaction picks.
  useEffect(() => {
    if (!editPersonaId) return;
    let active = true;
    (async () => {
      try {
        const data = await fetchPersonaInput(editPersonaId);
        if (!active) return;
        methods.reset(data.values);
        setInitialAvatarUrl(data.avatarUrl);
        setEditAvatar(
          data.avatarUrl ? { kind: "remote", url: data.avatarUrl } : { kind: "none" },
        );
        setEditMediaPicks(
          (data.values.mediaPills ?? []).map((name) => ({ name, previewUrl: "" })),
        );
        setEditLoad("ready");
      } catch {
        if (active) setEditLoad("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [editPersonaId, methods]);

  // A failed edit load can't recover in place — tell the user and bail back.
  useEffect(() => {
    if (editLoad === "error" && !leaving.current) {
      Alert.alert(t("personasCreator.loadError"));
      leave();
    }
  }, [editLoad, leave, t]);

  // The single close intent (X button + hardware back). Create always opens the
  // Save-draft/Discard menu (unsaved work never silently pops). Edit leaves
  // straight away when nothing changed, and only confirms when there are unsaved
  // changes — there's no draft to save, so it's discard-or-keep.
  const onPressClose = useCallback(() => {
    if (isEdit && !dirty) {
      leave();
      return;
    }
    setExitMenuOpen((open) => !open);
  }, [isEdit, dirty, leave]);

  // Hardware back (Android) routes through the same close intent.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onPressClose();
      return true;
    });
    return () => sub.remove();
  }, [onPressClose]);

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

  // Save an edit: validate, resolve the avatar action (keep / replace upload /
  // remove), overwrite via savePersona, then refresh the list and leave.
  // Selection is by id, so the edited persona stays selected if it already was.
  const handleSaveEdit = useCallback(async () => {
    if (publishing || !editPersonaId) return;
    setPublishError(null);
    const ok = await methods.trigger();
    if (!ok) {
      setPublishError(t("personasCreator.error.incomplete"));
      return;
    }
    const avatarState: EditAvatarState =
      editAvatar.kind === "local"
        ? { kind: "replace", localUri: editAvatar.localUri }
        : editAvatar.kind === "none" && initialAvatarUrl !== null
          ? { kind: "remove" }
          : { kind: "keep" };

    setPublishing(true);
    try {
      const result = await savePersonaEdit(
        editPersonaId,
        methods.getValues(),
        avatarState,
        {
          uploadAvatar: uploadPendingAvatar,
          savePersona: async (args) => {
            const res = await savePersonaCallable(args);
            return { personaId: res.personaId };
          },
        },
      );
      if (result.ok) {
        leaving.current = true;
        if (uid) await usePersonaStore.getState().hydrate(uid);
        leave();
        return;
      }
      setPublishError(t(`personasCreator.publishError.${result.reason}`));
    } finally {
      setPublishing(false);
    }
  }, [publishing, editPersonaId, methods, editAvatar, initialAvatarUrl, uid, leave, t]);

  // Edit discard: no draft to throw away — just leave (changes are dropped).
  const handleEditDiscard = useCallback(() => {
    leaving.current = true;
    setExitMenuOpen(false);
    leave();
  }, [leave]);

  if (isEdit) {
    if (editLoad === "loading") {
      return (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme["--color-background"],
          }}
        >
          <ActivityIndicator size="large" color={theme["--color-foreground-muted"]} />
        </View>
      );
    }
    // "error" routes back via the effect above; render nothing meanwhile.
    if (editLoad !== "ready") return null;
  } else if (!draft) {
    return null;
  }

  // The primary footer action and the X/back intent differ by mode; the rest of
  // the screen is identical, so it's rendered once and wrapped in the right
  // session provider (draft-backed for create, screen-owned for edit).
  const primaryLabel = isEdit
    ? t("personasCreator.saveChanges")
    : isLast
      ? t("personasCreator.publish")
      : t("personasCreator.next");
  const onPrimary = isLast ? (isEdit ? handleSaveEdit : handlePublish) : goNext;
  // Edit's final Save is gated on having actual changes; Next is always enabled.
  const primaryDisabled = publishing || (isEdit && isLast && !dirty);

  const screen = (
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
                onPress={onPressClose}
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
                  onPress={onPrimary}
                  disabled={primaryDisabled}
                  accessibilityLabel={primaryLabel}
                  pressScale={0.04}
                  containerStyle={{ flex: 1 }}
                  style={{
                    paddingVertical: 14,
                    borderRadius: 16,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme["--color-primary"],
                    opacity: primaryDisabled ? 0.5 : 1,
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
                      {primaryLabel}
                    </Typography>
                  )}
                </AppPressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>

        <ExitMenu
          open={exitMenuOpen}
          isEdit={isEdit}
          onClose={() => setExitMenuOpen(false)}
          onSaveDraft={handleSaveDraft}
          onDiscard={isEdit ? handleEditDiscard : handleDiscard}
        />
      </View>
    </FormProvider>
  );

  return isEdit ? (
    <CreatorSessionProvider value={editSession}>{screen}</CreatorSessionProvider>
  ) : (
    <DraftCreatorSession>{screen}</DraftCreatorSession>
  );
}

// ── Exit menu (the X popover: Save draft / Discard) ───────────────────────────

function ExitMenu({
  open,
  isEdit,
  onClose,
  onSaveDraft,
  onDiscard,
}: {
  open: boolean;
  // Edit mode has no draft: the menu drops "Save draft" and the discard row
  // becomes "Discard changes" (the screen only opens it when there ARE changes).
  isEdit: boolean;
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
            {isEdit ? t("personasCreator.editExitTitle") : t("personasCreator.exitTitle")}
          </Typography>
          {isEdit ? null : (
            <>
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
            </>
          )}
          <ExitRow
            icon={<Trash size={18} weight="bold" color={theme["--color-error"]} />}
            label={isEdit ? t("personasCreator.discardChanges") : t("personasCreator.discardDraft")}
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
