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
import { IconButton } from "@/components/IconButton";
import {
  ExitMenu,
  SaveMenu,
} from "@/components/personaCreator/CreatorExitMenus";
import {
  CreatorSessionProvider,
  DraftCreatorSession,
  type CreatorSession,
  type SessionAvatar,
} from "@/components/personaCreator/CreatorSession";
import { CreatorScratchProvider } from "@/components/personaCreator/CreatorScratch";
import { PublishingOverlay } from "@/components/personaCreator/PublishingOverlay";
import { StepBody } from "@/components/personaCreator/steps";
import { Typography } from "@/components/Typography";
import type { MediaPick } from "@/domain/personaDrafts";
import type { PickedAvatar } from "@/services/firebase/uploadPersonaAvatar";
import {
  EMPTY_PERSONA_FORM,
  PERSONA_STEP_FIELDS,
  PERSONA_STEPS,
  personaFormResolver,
  type PersonaFormValues,
  type PersonaStep,
} from "@/domain/personaForm";
import { publishPersonaDraft } from "@/domain/publishPersona";
import {
  savePersonaEdit,
  type EditAvatarState,
} from "@/domain/savePersonaEdit";
import { useTheme } from "@/hooks/useTheme";
import { fetchPersonaInput } from "@/services/firebase/personas";
import { savePersonaCallable } from "@/services/firebase/callables";
import { uploadPendingAvatar } from "@/services/firebase/uploadPersonaAvatar";
import { useAuthStore } from "@/store/auth";
import { useActiveDraft, usePersonaDraftStore } from "@/store/personaDraft";
import { usePersonaStore } from "@/store/personas";
import { EditAvatarCandidatesStorage } from "@/store/storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CaretLeft, FloppyDisk, X } from "phosphor-react-native";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { FormProvider, useForm, type Resolver } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function PersonaCreatorScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const draft = useActiveDraft();

  // EDIT mode is keyed by a ?personaId route param: there's no draft, the form
  // is seeded from the stored persona, and the only exits are the header's
  // "Save & exit" or "quit and lose changes" via the X (no draft autosave). The
  // footer is pure step navigation in this mode — Next, never a save.
  const params = useLocalSearchParams<{ personaId?: string }>();
  const editPersonaId =
    typeof params.personaId === "string" && params.personaId.length > 0
      ? params.personaId
      : null;
  const isEdit = editPersonaId !== null;

  const methods = useForm<PersonaFormValues>({
    // Edit seeds via reset() once the fetch lands (below); start empty so the
    // isDirty baseline is set by that reset, not a stale default.
    defaultValues: isEdit
      ? EMPTY_PERSONA_FORM
      : (draft?.values ?? EMPTY_PERSONA_FORM),
    resolver: personaFormResolver as unknown as Resolver<PersonaFormValues>,
    mode: "onTouched",
  });

  const [stepIndex, setStepIndex] = useState(isEdit ? 0 : (draft?.step ?? 0));
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  // CREATE-mode publish overlay: a dedicated "bringing it to life" screen that
  // can't be quit mid-save, then a success view with "Start Chatting Now". Name
  // + avatar are snapshotted at publish time so the overlay survives the draft
  // being discarded on success.
  const [publishPhase, setPublishPhase] = useState<
    "idle" | "publishing" | "done"
  >("idle");
  const [publishedName, setPublishedName] = useState("");
  const [publishedAvatarUri, setPublishedAvatarUri] = useState<string | null>(
    null,
  );
  const [exitMenuOpen, setExitMenuOpen] = useState(false);
  // Edit-only "save" popover (the floppy icon in the header → Save changes /
  // Save & exit), mirroring the X's exit popover.
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const uid = useAuthStore((s) => s.uid);

  // Screen-scoped scratch state for the wizard (survives moving between steps,
  // dropped when the creator closes). The step ScrollView is keyed by step so it
  // remounts per step; this ref points at whichever is current — enough for a
  // focused input to scroll itself above the keyboard. generatedAvatars keeps
  // the AI avatar candidates so tapping Next (which remounts the step) doesn't
  // throw them away.
  const scrollRef = useRef<ScrollView>(null);
  // The AI avatar candidate pair. In CREATE mode it lives ON THE DRAFT, so the
  // two candidates survive closing and reopening the creator (and "Save draft"),
  // not just the one the user selected. In EDIT mode there's no draft, so the
  // in-session copy is screen-local AND mirrored to per-persona durable storage
  // (EditAvatarCandidatesStorage) so the pair likewise survives the creator
  // closing — hydrated back on reopen by the effect below. Re-generating replaces
  // the list; the generator deletes the old candidate files, so stale generations
  // are never kept.
  const [editGenerated, setEditGenerated] = useState<PickedAvatar[]>([]);
  const generatedAvatars = isEdit ? editGenerated : (draft?.generatedAvatars ?? []);
  const setGeneratedAvatars = useCallback<Dispatch<SetStateAction<PickedAvatar[]>>>(
    (next) => {
      if (isEdit) {
        // Resolve functional updates against the live state so the durable mirror
        // gets the same value the in-flight generate composed into.
        setEditGenerated((prev) => {
          const resolved =
            typeof next === "function"
              ? (next as (p: PickedAvatar[]) => PickedAvatar[])(prev)
              : next;
          if (editPersonaId) {
            void EditAvatarCandidatesStorage.setFor(editPersonaId, resolved);
          }
          return resolved;
        });
        return;
      }
      // Read the latest off the store (not a stale closure) so functional
      // updates from the in-flight generate promise compose correctly.
      const store = usePersonaDraftStore.getState();
      const active = store.drafts.find((d) => d.id === store.activeId);
      const prev = active?.generatedAvatars ?? [];
      const resolved =
        typeof next === "function"
          ? (next as (p: PickedAvatar[]) => PickedAvatar[])(prev)
          : next;
      store.updateActive({ generatedAvatars: resolved });
    },
    [isEdit, editPersonaId],
  );
  // Edit mode: restore this persona's last generated pair so both options reappear
  // when the user reopens the editor (create mode gets this free off the draft).
  // Only a non-empty stored pair is applied, so it never clobbers an in-progress
  // generation whose result landed before the read returned.
  useEffect(() => {
    if (!editPersonaId) return;
    let active = true;
    void (async () => {
      const saved = await EditAvatarCandidatesStorage.getFor(editPersonaId);
      if (active && saved.length > 0) setEditGenerated(saved);
    })();
    return () => {
      active = false;
    };
  }, [editPersonaId]);
  // Client-side SOFT rate limit for avatar regeneration (a bypass isn't harmful
  // — the credit charge is the real guard). Lives here so it survives steps.
  const [cooldownUntil, setCooldownUntil] = useState(0);
  // In-flight flags for the two billed creator jobs (avatar generation, AI
  // description). They live on the screen, ABOVE the per-step remount, so a
  // request the user kicked off keeps running behind the scenes when they tap
  // Next/Back: the promise's closure still writes its result (avatars to scratch,
  // the description to the form) and flips the flag off here when it lands. On
  // return the step re-reads these, so it shows the spinner instead of an idle
  // button the user might tap again and get double-charged for.
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [describeBusy, setDescribeBusy] = useState(false);
  const [describeCooldownUntil, setDescribeCooldownUntil] = useState(0);
  const scratch = useMemo(
    () => ({
      scrollToEnd: () => scrollRef.current?.scrollToEnd({ animated: true }),
      // Review/overview → jump to a section's editor. Clamp to a real step.
      goToStep: (target: PersonaStep) => {
        const idx = PERSONA_STEPS.indexOf(target);
        if (idx >= 0) setStepIndex(idx);
      },
      generatedAvatars,
      setGeneratedAvatars,
      cooldownUntil,
      setCooldownUntil,
      avatarBusy,
      setAvatarBusy,
      describeBusy,
      setDescribeBusy,
      describeCooldownUntil,
      setDescribeCooldownUntil,
    }),
    [
      generatedAvatars,
      setGeneratedAvatars,
      cooldownUntil,
      avatarBusy,
      describeBusy,
      describeCooldownUntil,
    ],
  );

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

  // Fetch the stored persona and seed the editable state from it: the form
  // (reset() establishes the isDirty baseline), the avatar, and the reaction
  // picks. Reused on first load AND after a "Save changes" (save-and-stay) so
  // the dirty baseline is re-pinned to the now-saved server copy — savePersona
  // doesn't return the new avatar URL, so re-seeding is the reliable re-baseline.
  const seedFromStored = useCallback(async () => {
    if (!editPersonaId) return;
    const data = await fetchPersonaInput(editPersonaId);
    methods.reset(data.values);
    setInitialAvatarUrl(data.avatarUrl);
    setEditAvatar(
      data.avatarUrl
        ? { kind: "remote", url: data.avatarUrl }
        : { kind: "none" },
    );
    // Seed from the persisted picks (name + preview URL) so the tray shows real
    // thumbnails; personaInputToMediaPicks falls back to names-only for personas
    // saved before preview URLs were stored.
    setEditMediaPicks(data.mediaPicks);
  }, [editPersonaId, methods]);

  // Edit mode: load the stored persona once and flip to "ready" (or "error").
  useEffect(() => {
    if (!editPersonaId) return;
    let active = true;
    (async () => {
      try {
        await seedFromStored();
        if (active) setEditLoad("ready");
      } catch {
        if (active) setEditLoad("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [editPersonaId, seedFromStored]);

  // A failed edit load can't recover in place — tell the user and bail back.
  useEffect(() => {
    if (editLoad === "error" && !leaving.current) {
      Alert.alert(t("personasCreator.loadError"));
      leave();
    }
  }, [editLoad, leave, t]);

  // Leave the success view straight into the chat (the persona is already
  // selected). The working draft was discarded on publish success.
  const handleStartChatting = useCallback(() => {
    leaving.current = true;
    leave();
  }, [leave]);

  // The single close intent (X button + hardware back). While the publish
  // overlay is up the user can't bail: mid-save it's a no-op, and on the success
  // view it routes through "Start Chatting". Otherwise: create opens the
  // Save-draft/Discard menu; edit leaves when clean, confirms when dirty.
  const onPressClose = useCallback(() => {
    if (publishPhase === "publishing") return;
    if (publishPhase === "done") {
      handleStartChatting();
      return;
    }
    if (isEdit && !dirty) {
      leave();
      return;
    }
    setExitMenuOpen((open) => !open);
  }, [publishPhase, handleStartChatting, isEdit, dirty, leave]);

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

    // Snapshot what the overlay shows, so it stays correct after the draft is
    // discarded on success.
    setPublishedName(
      methods.getValues().displayName?.trim() ||
        t("personasCreator.field.botFallback"),
    );
    setPublishedAvatarUri(activeDraft.avatar?.localUri ?? null);
    setPublishing(true);
    setPublishPhase("publishing");
    try {
      const result = await publishPersonaDraft(activeDraft, {
        uploadAvatar: uploadPendingAvatar,
        savePersona: async (args) => {
          const res = await savePersonaCallable(args);
          return { personaId: res.personaId };
        },
      });
      if (result.ok) {
        // Mark leaving so the "no active draft" guard doesn't pop the screen
        // when we discard below — we stay to show the success view; the user
        // leaves via "Start Chatting Now".
        leaving.current = true;
        // Carry the draft's candidate pair onto the now-published persona so the
        // two options are still there if the user immediately edits it — the draft
        // that held them is discarded on the next line.
        if (activeDraft.generatedAvatars.length > 0) {
          void EditAvatarCandidatesStorage.setFor(
            result.personaId,
            activeDraft.generatedAvatars,
          );
        }
        usePersonaDraftStore.getState().discard(activeDraft.id);
        if (uid) await usePersonaStore.getState().hydrate(uid);
        usePersonaStore.getState().select(result.personaId);
        setPublishPhase("done");
        return;
      }
      setPublishError(t(`personasCreator.publishError.${result.reason}`));
      setPublishPhase("idle");
    } catch {
      setPublishError(t("personasCreator.publishError.error"));
      setPublishPhase("idle");
    } finally {
      setPublishing(false);
    }
  }, [publishing, methods, flush, uid, t]);

  // The avatar's edit-session action, derived from the live session state:
  // a freshly-picked local image (replace + upload), a cleared stored one
  // (remove), or no change (keep).
  const currentAvatarState = useCallback(
    (): EditAvatarState =>
      editAvatar.kind === "local"
        ? { kind: "replace", localUri: editAvatar.localUri }
        : editAvatar.kind === "none" && initialAvatarUrl !== null
          ? { kind: "remove" }
          : { kind: "keep" },
    [editAvatar, initialAvatarUrl],
  );

  // Validate + persist the edit — shared by "Save changes" (stay) and "Save &
  // exit". Overwrites via savePersona, refreshes the persona list on success,
  // and returns whether it saved (setting the soft error itself on failure).
  // On success it deliberately leaves `publishing` TRUE so the caller can finish
  // its follow-up (re-seed or navigate) before the spinner clears.
  const persistEdit = useCallback(async (): Promise<boolean> => {
    if (publishing || !editPersonaId) return false;
    setPublishError(null);
    const ok = await methods.trigger();
    if (!ok) {
      setPublishError(t("personasCreator.error.incomplete"));
      return false;
    }
    setPublishing(true);
    const result = await savePersonaEdit(
      editPersonaId,
      methods.getValues(),
      currentAvatarState(),
      {
        uploadAvatar: uploadPendingAvatar,
        savePersona: async (args) => {
          const res = await savePersonaCallable(args);
          return { personaId: res.personaId };
        },
      },
      // Persist the picked reactions' preview URLs so re-editing shows thumbnails.
      editMediaPicks,
    );
    if (result.ok) {
      if (uid) await usePersonaStore.getState().hydrate(uid);
      return true;
    }
    setPublishError(t(`personasCreator.publishError.${result.reason}`));
    setPublishing(false);
    return false;
  }, [publishing, editPersonaId, methods, currentAvatarState, editMediaPicks, uid, t]);

  // "Save & exit": persist, then leave (selection is by id, so the edited
  // persona stays selected if it already was).
  const handleSaveEdit = useCallback(async () => {
    setSaveMenuOpen(false);
    if (await persistEdit()) {
      leaving.current = true;
      leave();
    }
  }, [persistEdit, leave]);

  // "Save changes": persist, then re-seed from the saved copy so the dirty
  // baseline resets and the user stays in the editor. A re-seed hiccup is
  // non-fatal (the save already succeeded) — just clear the spinner.
  const handleSaveStay = useCallback(async () => {
    setSaveMenuOpen(false);
    if (await persistEdit()) {
      try {
        await seedFromStored();
      } finally {
        setPublishing(false);
      }
    }
  }, [persistEdit, seedFromStored]);

  // Footer primary on the LAST step (review) in edit mode — mirrors create's
  // "Save bot": a save that also finishes, instead of a dead "Next" that loops
  // back to the overview. Dirty → persist + exit; clean → just exit (nothing to
  // write). The header save popover stays for mid-flow saves.
  const handleFinishEdit = useCallback(() => {
    if (dirty) void handleSaveEdit();
    else leave();
  }, [dirty, handleSaveEdit, leave]);

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
          <ActivityIndicator
            size="large"
            color={theme["--color-foreground-muted"]}
          />
        </View>
      );
    }
    // "error" routes back via the effect above; render nothing meanwhile.
    if (editLoad !== "ready") return null;
  } else if (!draft && publishPhase === "idle") {
    // No draft is impossible from the picker; but DON'T bail while the publish
    // overlay is up — success discards the draft yet we stay to show it.
    return null;
  }

  // The primary footer action and the X/back intent differ by mode; the rest of
  // the screen is identical, so it's rendered once and wrapped in the right
  // session provider (draft-backed for create, screen-owned for edit).
  //
  // Edit mode decouples navigation from saving: the footer is step navigation
  // ("Next") UNTIL the last step (review), where it becomes the finishing save —
  // "Save changes" when there are edits, "Done" when there aren't — so reaching
  // the overview doesn't dead-end on a "Next" with nowhere to go. The header's
  // "Save & exit" popover still offers a mid-flow save from any step. Create
  // keeps Next → "Save bot" on the last step.
  const primaryLabel = isEdit
    ? isLast
      ? dirty
        ? t("personasCreator.saveChanges")
        : t("common.done")
      : t("personasCreator.next")
    : isLast
      ? t("personasCreator.publish")
      : t("personasCreator.next");
  const onPrimary = isEdit
    ? isLast
      ? handleFinishEdit
      : goNext
    : isLast
      ? handlePublish
      : goNext;
  const primaryDisabled = publishing;
  // Header save icon (edit only): enabled once there are unsaved changes; opens
  // the Save changes / Save & exit popover.
  const canSave = isEdit && dirty && !publishing;

  const screen = (
    <FormProvider {...methods}>
      <View style={{ flex: 1, backgroundColor: theme["--color-background"] }}>
        <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ flex: 1 }}
          >
            {/* Header: save icon (edit only, left) · step dots (center) · X exit
                (right). The save and X are matching glass icon buttons; the side
                slots are flex:1 so the dots stay screen-centered. Back lives in
                the footer. In create mode the left slot is an empty spacer. */}
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
              <View style={{ flex: 1, alignItems: "flex-start" }}>
                {isEdit ? (
                  <IconButton
                    onPress={() => setSaveMenuOpen((open) => !open)}
                    disabled={!canSave}
                    busy={publishing}
                    busyColor={theme["--color-foreground"]}
                    hitSlop={8}
                    size={36}
                    glass
                    fallbackStyle={{
                      backgroundColor: theme["--color-card-muted"],
                    }}
                    accessibilityLabel={t("personasCreator.saveChanges")}
                    surfaceStyle={{ opacity: canSave || publishing ? 1 : 0.4 }}
                    accessibilityState={{ expanded: saveMenuOpen }}
                  >
                    <FloppyDisk
                      size={18}
                      weight="bold"
                      color={theme["--color-foreground"]}
                    />
                  </IconButton>
                ) : null}
              </View>

              {/* Progress bar — replaces the old dot row now that the wizard has
                  many steps (one dot per step would read like a ruler). Fills as
                  the user advances; the side slots are flex:1 so it stays
                  screen-centered. */}
              <View
                accessibilityRole="progressbar"
                accessibilityValue={{
                  min: 1,
                  max: PERSONA_STEPS.length,
                  now: stepIndex + 1,
                }}
                style={{
                  width: 180,
                  height: 6,
                  borderRadius: 999,
                  overflow: "hidden",
                  backgroundColor: theme["--color-border-strong"],
                }}
              >
                <View
                  style={{
                    width: `${((stepIndex + 1) / PERSONA_STEPS.length) * 100}%`,
                    height: "100%",
                    borderRadius: 999,
                    backgroundColor: theme["--color-primary"],
                  }}
                />
              </View>

              <View style={{ flex: 1, alignItems: "flex-end" }}>
                <IconButton
                  onPress={onPressClose}
                  hitSlop={8}
                  size={36}
                  glass
                  fallbackStyle={{
                    backgroundColor: theme["--color-card-muted"],
                  }}
                  accessibilityLabel={t("common.close")}
                >
                  <X
                    size={18}
                    weight="bold"
                    color={theme["--color-foreground"]}
                  />
                </IconButton>
              </View>
            </View>

            {/* One step at a time (no measured pager → no first-paint flash). The
                key resets scroll position between steps; inputs keep their values
                from the form context. */}
            <ScrollView
              ref={scrollRef}
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
              <CreatorScratchProvider value={scratch}>
                <StepBody step={step} />
              </CreatorScratchProvider>
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
                  <CaretLeft
                    size={16}
                    weight="bold"
                    color={theme["--color-foreground"]}
                  />
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
                    <ActivityIndicator
                      size="small"
                      color={theme["--color-primary-foreground"]}
                    />
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

        {isEdit ? (
          <SaveMenu
            open={saveMenuOpen}
            onClose={() => setSaveMenuOpen(false)}
            onSaveChanges={handleSaveStay}
            onSaveAndExit={handleSaveEdit}
          />
        ) : null}

        {!isEdit && publishPhase !== "idle" ? (
          <PublishingOverlay
            phase={publishPhase}
            name={publishedName}
            avatarUri={publishedAvatarUri}
            onStart={handleStartChatting}
          />
        ) : null}
      </View>
    </FormProvider>
  );

  return isEdit ? (
    <CreatorSessionProvider value={editSession}>
      {screen}
    </CreatorSessionProvider>
  ) : (
    <DraftCreatorSession>{screen}</DraftCreatorSession>
  );
}
