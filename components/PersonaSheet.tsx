// PersonaSheet
//
// The persona picker — a near-full-height sheet (iOS 26 "tap the name" menu
// feel) for choosing which bot you chat as. Top: a hero showing the currently
// selected persona. Below: "Your Brainrot Bots" with a glass + to create one,
// then the selectable list (the default Brainrot Bot first, then the user's
// saved bots), capped by a create row — which becomes an UPGRADE nudge for
// free users who've hit their 1-persona cap. A fixed ad banner sits at the
// bottom for free users (it self-hides for paid).
//
// Selection is cosmetic for now: it updates the local persona store (and the
// chat header pill), but the chat send path does not yet forward personaId.
// Creating/editing personas is a later step — the + button and create row are
// inert except for the free-tier upgrade route.
//
// Mounted once at the root layout (like the other global sheets) so it spans
// the full width and survives navigation.

import {
  AppPressable,
  SheetTouchableProvider,
} from "@/components/AppPressable";
import { AdBanner } from "@/components/ads/AdBanner";
import { GlassSurface } from "@/components/GlassSurface";
import { IconButton } from "@/components/IconButton";
import { MAX_CONTENT_WIDTH } from "@/components/MaxWidthFrame";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import { UpgradeButton } from "@/components/chat/UpgradeButton";
import { DeleteConfirm } from "@/components/personaCreator/DeletePersonaConfirm";
import { DraftsPopover } from "@/components/personaCreator/DraftsPopover";
import { PersonaRow } from "@/components/personaCreator/PersonaRow";
import { SheetBackdrop } from "@/components/SheetBackdrop";
import { Typography } from "@/components/Typography";
import {
  DEFAULT_PERSONA_ID,
  FIRST_PARTY_PERSONAS,
  personaCap,
  type ResolvedPersona,
} from "@/domain/personas";
import { useTheme } from "@/hooks/useTheme";
import { useOpenPlan } from "@/hooks/useOpenPlan";
import { useDisplayPlan } from "@/store/entitlement";
import { usePersonaDraftStore, useSavedDrafts } from "@/store/personaDraft";
import { usePersonaSheetStore } from "@/store/personaSheet";
import { usePersonaStore, useSelectedPersona } from "@/store/personas";
import {
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { deletePersonaCallable } from "@/services/firebase/callables";
import { PencilSimple, Plus, Trash, X } from "phosphor-react-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  FadeIn,
  LinearTransition,
} from "react-native-reanimated";

// The hero's "online" dot — a clean, always-on presence cue next to the bot's
// name. A fixed vivid green (not theme-derived) so it reads as "online" in both
// light and dark, the way every chat app's presence dot does.
const ONLINE_GREEN = "#34C759";

export function PersonaSheet() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const isOpen = usePersonaSheetStore((s) => s.isOpen);
  const close = usePersonaSheetStore((s) => s.close);
  const openPlan = useOpenPlan();

  const personas = usePersonaStore((s) => s.personas);
  const select = usePersonaStore((s) => s.select);
  const selectedPersonaId = usePersonaStore((s) => s.selectedPersonaId);
  const selected = useSelectedPersona();

  const router = useRouter();
  // Saved drafts only — a just-created, never-saved working draft must not bump
  // the pill (the user sees "Drafts (1)" the moment they tap Create otherwise).
  const drafts = useSavedDrafts();
  const openDraft = usePersonaDraftStore((s) => s.open);
  const discardDraft = usePersonaDraftStore((s) => s.discard);

  const plan = useDisplayPlan();
  const isFree = plan === "free";
  const cap = personaCap(plan);
  const atCap = personas.length >= cap;

  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ["80%"], []);

  useEffect(() => {
    if (isOpen) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [isOpen]);

  // The glass drafts popover, anchored just under the header row. The popover
  // renders in a full-window Modal (so its dim covers the whole page, not just
  // the sheet), so the anchor is measured in WINDOW coordinates, not relative.
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [anchorBottom, setAnchorBottom] = useState(0);
  const headerRowRef = useRef<View>(null);
  const measureHeaderRow = useCallback(() => {
    headerRowRef.current?.measureInWindow((_x, y, _w, h) =>
      setAnchorBottom(y + h),
    );
  }, []);
  const toggleDrafts = useCallback(() => {
    setDraftsOpen((prev) => {
      if (!prev) measureHeaderRow(); // re-measure on open (sheet is settled)
      return !prev;
    });
  }, [measureHeaderRow]);

  // Close the popover when the sheet closes or the last draft is removed.
  useEffect(() => {
    if (!isOpen) setDraftsOpen(false);
  }, [isOpen]);
  useEffect(() => {
    if (drafts.length === 0) setDraftsOpen(false);
  }, [drafts.length]);

  // Multi-select-to-delete, mirroring the chat history list. Selection mode is
  // simply "something is marked" — a long-press on a user bot seeds it, tapping
  // toggles, clearing the set exits. Only user bots are deletable; the default
  // Brainrot Bot is never markable. RN's <Modal> can stack oddly over a bottom
  // sheet, so the confirm is an in-sheet overlay (see DeleteConfirm).
  const [markedIds, setMarkedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Brief post-success "Deleted" confirmation shown before the modal closes.
  const [deleted, setDeleted] = useState(false);
  const selectionMode = markedIds.size > 0;

  // Display names of the marked bots — the confirm modal needs them for its
  // "Delete {name}" title and type-to-confirm target. Snapshotted from the live
  // list so the modal keeps the right names even as rows are about to leave.
  const markedNames = useMemo(
    () => personas.filter((p) => markedIds.has(p.id)).map((p) => p.displayName),
    [personas, markedIds],
  );

  // Leaving the sheet (or losing the underlying bots) drops any in-progress
  // selection so it never lingers into the next open.
  useEffect(() => {
    if (!isOpen) {
      setMarkedIds(new Set());
      setConfirmOpen(false);
      setDeleted(false);
    }
  }, [isOpen]);

  const toggleMark = useCallback((id: string) => {
    setMarkedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearMarks = useCallback(() => setMarkedIds(new Set()), []);

  // Selecting no longer auto-closes: the picker doubles as a manage surface
  // (the hero's Edit acts on the selected persona), so tapping a row updates the
  // hero + active check and leaves the sheet open. Dismiss is via backdrop/pan.
  const handleSelect = useCallback(
    (personaId: string) => {
      select(personaId);
    },
    [select],
  );

  // Edit the currently-selected persona (user bots only — the default isn't
  // editable). Closes the picker first so the two surfaces don't stack.
  const handleEditSelected = useCallback(() => {
    if (selected.kind !== "user") return;
    const id = selected.persona.id;
    close();
    router.push(`/persona-creator?personaId=${id}`);
  }, [selected, close, router]);

  // A user bot's tap: toggles its mark in selection mode, otherwise selects it
  // as the active chat persona. (The default bot bypasses this — it's never
  // markable, so a tap on it always just selects.)
  const handleUserRowPress = useCallback(
    (personaId: string) => {
      if (selectionMode) toggleMark(personaId);
      else handleSelect(personaId);
    },
    [selectionMode, toggleMark, handleSelect],
  );

  const handleDeleteConfirmed = useCallback(async () => {
    const ids = [...markedIds];
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      await Promise.all(ids.map((id) => deletePersonaCallable(id)));
      // Success: flip to the "Deleted" confirmation, hold it briefly, THEN drop
      // the rows locally (exit + reflow) and close. Dropping after the close
      // keeps the modal's title/name intact while the success state shows.
      setDeleting(false);
      setDeleted(true);
      setTimeout(() => {
        usePersonaStore.getState().removeMany(ids);
        clearMarks();
        setConfirmOpen(false);
        setDeleted(false);
      }, 850);
    } catch (err) {
      console.warn("[personas] delete failed:", err);
      setDeleting(false);
      Alert.alert(t("common.error"));
    }
  }, [markedIds, clearMarks, t]);

  // The create affordance: free users at their cap go to the paywall; everyone
  // under the cap seeds a fresh blank draft and opens the creator straight into
  // the wizard (there's no template picker). Paid-at-cap is a dead end (the
  // "max reached" note shows instead of a create row). The picker closes first
  // so the two sheets don't stack.
  const handleCreate = useCallback(() => {
    if (atCap && isFree) {
      close();
      openPlan();
      return;
    }
    if (atCap) return;
    // Seed a blank working draft. null = the local draft cap is full (distinct
    // from the persona cap above): keep the picker open and tell them why.
    const id = usePersonaDraftStore.getState().newDraft(null);
    if (!id) {
      Alert.alert(t("personasCreator.capReached"));
      return;
    }
    close();
    router.push("/persona-creator");
  }, [atCap, isFree, close, openPlan, router, t]);

  // Resume a saved draft: make it active, then open the creator straight into
  // the wizard.
  const handleResumeDraft = useCallback(
    (draftId: string) => {
      openDraft(draftId);
      close();
      router.push("/persona-creator");
    },
    [openDraft, close, router],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <SheetBackdrop {...props} opacity={0.5} />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
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
        backgroundColor: theme["--color-foreground-muted"],
      }}
    >
      <View
        style={{
          flex: 1,
          width: "100%",
          maxWidth: MAX_CONTENT_WIDTH,
          alignSelf: "center",
        }}
      >
        <SheetTouchableProvider>
          {/* Hero: the currently selected persona — a left-aligned row (avatar +
              name + subtle one-liner), matching the persona list rows below.
              Dismiss is via pan-down or the backdrop, so there's no close button. */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              paddingHorizontal: 20,
              paddingTop: 8,
              paddingBottom: 18,
            }}
          >
            <PersonaAvatar persona={selected} size={56} />
            <View style={{ flex: 1, gap: 3 }}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Typography
                  variant="title-lg"
                  numberOfLines={1}
                  style={{ color: theme["--color-foreground"], flexShrink: 1 }}
                >
                  {personaName(selected, t("chat.agentName"))}
                </Typography>
                {/* Online dot — a clean green presence cue next to the name. */}
                <View
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 999,
                    backgroundColor: ONLINE_GREEN,
                  }}
                />
              </View>
              <Typography
                variant="caption"
                numberOfLines={1}
                style={{ color: theme["--color-foreground-secondary"] }}
              >
                {personaDescription(selected, t("personas.defaultDescription"))}
              </Typography>
            </View>

            {/* Edit the selected persona — user bots only (the default has no
                editable spec). Sits on the hero (its least-crowded surface) and
                acts on whatever's currently selected. */}
            {selected.kind === "user" ? (
              <IconButton
                onPress={handleEditSelected}
                size={38}
                glass
                fallbackStyle={{
                  backgroundColor: theme["--color-card"],
                  borderWidth: 1,
                  borderColor: theme["--color-border"],
                }}
                accessibilityLabel={t("personas.editA11y", {
                  name: personaName(selected, t("chat.agentName")),
                })}
              >
                <PencilSimple
                  size={18}
                  weight="bold"
                  color={theme["--color-foreground"]}
                />
              </IconButton>
            ) : null}
          </View>

          {/* System bot(s) — shown at the top with NO section title, above the
              "Your Brainrot Bots" header. The default Brainrot Bot plus any
              curated first-party bots (e.g. Luna) are always available so the
              user can switch between them and back from a custom bot; they're
              system bots, never deletable, and not part of the "your bots"
              selection below. */}
          <View style={{ paddingHorizontal: 16, paddingBottom: 14, gap: 10 }}>
            <PersonaRow
              name={t("chat.agentName")}
              description={t("personas.defaultDescription")}
              avatar={<PersonaAvatar persona={{ kind: "default" }} size={44} />}
              active={selectedPersonaId === DEFAULT_PERSONA_ID}
              selectionMode={selectionMode}
              deletable={false}
              onPress={() => {
                if (!selectionMode) handleSelect(DEFAULT_PERSONA_ID);
              }}
              selectA11y={t("personas.selectA11y", {
                name: t("chat.agentName"),
              })}
            />
            {FIRST_PARTY_PERSONAS.map((p) => (
              <PersonaRow
                key={p.id}
                name={p.displayName}
                description={p.shortDescription}
                avatar={
                  <PersonaAvatar
                    persona={{ kind: "firstParty", persona: p }}
                    size={44}
                  />
                }
                active={selectedPersonaId === p.id}
                selectionMode={selectionMode}
                deletable={false}
                onPress={() => {
                  if (!selectionMode) handleSelect(p.id);
                }}
                selectA11y={t("personas.selectA11y", { name: p.displayName })}
              />
            ))}
          </View>

          {/* Section header: "Your Brainrot Bots" + (Drafts pill) + a glass + to
              create — now labels only the user's own bots below it. The row's
              measured bottom anchors the drafts popover. */}
          <View
            ref={headerRowRef}
            onLayout={measureHeaderRow}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 20,
              paddingBottom: 10,
            }}
          >
            <Typography
              variant="title-sm"
              style={{ color: theme["--color-foreground"] }}
            >
              {selectionMode
                ? t("personas.select.count", { count: markedIds.size })
                : t("personas.yourBots")}
            </Typography>
            {selectionMode ? (
              // Selection mode: cancel (clears marks) + a loud, error-tinted
              // trash that opens the confirm. Mirrors the history header swap.
              <Animated.View
                entering={FadeIn.duration(160)}
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <IconButton
                  onPress={clearMarks}
                  size={34}
                  glass
                  fallbackStyle={{
                    backgroundColor: theme["--color-card"],
                    borderWidth: 1,
                    borderColor: theme["--color-border"],
                  }}
                  accessibilityLabel={t("personas.select.cancelA11y")}
                >
                  <X
                    size={18}
                    weight="bold"
                    color={theme["--color-foreground"]}
                  />
                </IconButton>
                <IconButton
                  onPress={() => setConfirmOpen(true)}
                  size={34}
                  surfaceStyle={{
                    backgroundColor: theme["--color-error-muted"],
                  }}
                  accessibilityLabel={t("personas.select.deleteA11y")}
                >
                  <Trash
                    size={18}
                    weight="bold"
                    color={theme["--color-error"]}
                  />
                </IconButton>
              </Animated.View>
            ) : (
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                {drafts.length > 0 ? (
                  <DraftsPill count={drafts.length} onPress={toggleDrafts} />
                ) : null}
                {/* The + is purely "create a bot" — disabled (and dimmed) at the
                    cap, where you can't. The upgrade pill (free) / max-reached note
                    (paid) below carries the next action instead. Opacity stays
                    non-zero so the glass material survives (see GlassSurface). */}
                <View style={{ opacity: atCap ? 0.4 : 1 }}>
                  <IconButton
                    onPress={handleCreate}
                    disabled={atCap}
                    size={34}
                    glass
                    glassTint={theme["--color-primary"]}
                    fallbackStyle={{
                      backgroundColor: theme["--color-card"],
                      borderWidth: 1,
                      borderColor: theme["--color-border"],
                    }}
                    accessibilityLabel={t("personas.createA11y")}
                  >
                    <Plus
                      size={18}
                      weight="bold"
                      color={theme["--color-foreground"]}
                    />
                  </IconButton>
                </View>
              </View>
            )}
          </View>

          <BottomSheetScrollView
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingBottom: 24,
              gap: 10,
            }}
            showsVerticalScrollIndicator={false}
          >
            {personas.map((persona) => (
              // On delete the row is removed and the siblings' layout transition
              // slides up to fill the gap. NOTE: no opacity `exiting` fade — the
              // row's background is a GlassSurface, and fading a glass subtree
              // through opacity 0 permanently blanks the native material (the
              // "row lost its background" bug). Motion-only reorder sidesteps it.
              <Animated.View
                key={persona.id}
                layout={LinearTransition.duration(220).easing(
                  Easing.out(Easing.cubic),
                )}
              >
                <PersonaRow
                  name={persona.displayName}
                  description={persona.shortDescription}
                  avatar={
                    <PersonaAvatar
                      persona={{ kind: "user", persona }}
                      size={44}
                    />
                  }
                  active={selectedPersonaId === persona.id}
                  selectionMode={selectionMode}
                  marked={markedIds.has(persona.id)}
                  deletable
                  onPress={() => handleUserRowPress(persona.id)}
                  onLongPress={() => toggleMark(persona.id)}
                  selectA11y={t("personas.selectA11y", {
                    name: persona.displayName,
                  })}
                />
              </Animated.View>
            ))}

            {/* Create row → upgrade nudge (free at cap) → quiet max note
                (paid at cap) → inert create affordance (under cap). */}
            {atCap && isFree ? (
              <View style={{ gap: 8, paddingTop: 2 }}>
                <Typography
                  variant="caption"
                  style={{
                    color: theme["--color-foreground-muted"],
                    textAlign: "center",
                  }}
                >
                  {t("personas.upgradeBody", { count: personaCap("plus") })}
                </Typography>
                <UpgradeButton isTopTier={false} onPress={handleCreate} />
              </View>
            ) : atCap ? (
              <Typography
                variant="caption"
                style={{
                  color: theme["--color-foreground-muted"],
                  textAlign: "center",
                  paddingVertical: 14,
                }}
              >
                {t("personas.maxReached", { count: cap })}
              </Typography>
            ) : (
              <CreateRow label={t("personas.create")} onPress={handleCreate} />
            )}
          </BottomSheetScrollView>

          {/* Fixed ad band (free only — AdBanner renders null for paid). */}
          <View
            style={{
              paddingHorizontal: 16,
              paddingBottom: insets.bottom + 8,
              paddingTop: 4,
            }}
          >
            <AdBanner />
          </View>

          <DraftsPopover
            open={draftsOpen}
            anchorTop={anchorBottom}
            drafts={drafts}
            onResume={(id) => {
              setDraftsOpen(false);
              handleResumeDraft(id);
            }}
            onDiscard={discardDraft}
            onClose={() => setDraftsOpen(false)}
          />
        </SheetTouchableProvider>
      </View>
      {/* Rendered OUTSIDE the sheet (and its SheetTouchableProvider) as a native
          RN <Modal>: it presents in its own full-window layer above the sheet —
          so the dim covers the whole page, not just the sheet — and its RN
          Pressables work without fighting the sheet's gesture-handler pan. */}
      <DeleteConfirm
        open={confirmOpen}
        names={markedNames}
        deleting={deleting}
        deleted={deleted}
        onConfirm={() => void handleDeleteConfirmed()}
        onCancel={() => setConfirmOpen(false)}
      />
    </BottomSheetModal>
  );
}

// The resolved persona's display name — the localized default name when on the
// default, otherwise the user persona's own name.
function personaName(persona: ResolvedPersona, defaultName: string): string {
  return persona.kind === "default" ? defaultName : persona.persona.displayName;
}

// The resolved persona's one-liner — the localized default description on the
// default, otherwise the user persona's own short description.
function personaDescription(
  persona: ResolvedPersona,
  defaultDescription: string,
): string {
  return persona.kind === "default"
    ? defaultDescription
    : persona.persona.shortDescription;
}

// The "create a new bot" affordance: a dashed, plus-led row. Inert for now
// (the builder flow lands later).
function CreateRow({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <AppPressable
      onPress={onPress}
      accessibilityLabel={label}
      pressScale={0.02}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: theme["--color-border-strong"],
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme["--color-card-muted"],
        }}
      >
        <Plus size={20} weight="bold" color={theme["--color-foreground"]} />
      </View>
      <Typography
        variant="body"
        weight="semibold"
        style={{ color: theme["--color-foreground"], flex: 1 }}
      >
        {label}
      </Typography>
    </AppPressable>
  );
}

// The "Drafts (N)" pill beside the + button — toggles the drafts popover. Only
// rendered when at least one local draft exists.
function DraftsPill({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <AppPressable
      onPress={onPress}
      accessibilityLabel={t("personasCreator.draftsButton", { count })}
      pressScale={0.04}
    >
      <GlassSurface
        style={{
          height: 34,
          borderRadius: 17,
          paddingHorizontal: 14,
          alignItems: "center",
          justifyContent: "center",
        }}
        fallbackStyle={{
          backgroundColor: theme["--color-card"],
          borderWidth: 1,
          borderColor: theme["--color-border"],
        }}
      >
        <Typography
          variant="caption"
          weight="semibold"
          style={{ color: theme["--color-foreground"] }}
        >
          {t("personasCreator.draftsButton", { count })}
        </Typography>
      </GlassSurface>
    </AppPressable>
  );
}
