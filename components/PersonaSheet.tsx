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

import { AppPressable, SheetTouchableProvider } from "@/components/AppPressable";
import { AdBanner } from "@/components/ads/AdBanner";
import { GlassSurface } from "@/components/GlassSurface";
import { IconButton } from "@/components/IconButton";
import { MAX_CONTENT_WIDTH } from "@/components/MaxWidthFrame";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import { UpgradeButton } from "@/components/chat/UpgradeButton";
import { DraftsPopover } from "@/components/personaCreator/DraftsPopover";
import { SheetBackdrop } from "@/components/SheetBackdrop";
import { Typography } from "@/components/Typography";
import {
  DEFAULT_PERSONA_ID,
  personaCap,
  type ResolvedPersona,
} from "@/domain/personas";
import { useTheme } from "@/hooks/useTheme";
import { useOpenPlan } from "@/hooks/useOpenPlan";
import { useDisplayPlan } from "@/store/entitlement";
import { usePersonaDraftStore } from "@/store/personaDraft";
import { usePersonaSheetStore } from "@/store/personaSheet";
import { usePersonaStore, useSelectedPersona } from "@/store/personas";
import {
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { Portal } from "@gorhom/portal";
import { deletePersonaCallable } from "@/services/firebase/callables";
import { Check, CheckCircle, Plus, Trash, X } from "phosphor-react-native";
import { useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
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
  const drafts = usePersonaDraftStore((s) => s.drafts);
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

  // The glass drafts popover, anchored just under the header row.
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [anchorBottom, setAnchorBottom] = useState(0);

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
  const selectionMode = markedIds.size > 0;

  // Leaving the sheet (or losing the underlying bots) drops any in-progress
  // selection so it never lingers into the next open.
  useEffect(() => {
    if (!isOpen) {
      setMarkedIds(new Set());
      setConfirmOpen(false);
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

  const handleSelect = useCallback(
    (personaId: string) => {
      select(personaId);
      close();
    },
    [select, close],
  );

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
      // Drop them locally so the rows animate out (exit + reflow) without a
      // round-trip re-fetch; the selection reset to default is handled inside.
      usePersonaStore.getState().removeMany(ids);
      clearMarks();
      setConfirmOpen(false);
    } catch (err) {
      console.warn("[personas] delete failed:", err);
      Alert.alert(t("common.error"));
    } finally {
      setDeleting(false);
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
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
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
          </View>

          {/* Section header: "Your Brainrot Bots" + (Drafts pill) + a glass + to
              create. The row's measured bottom anchors the drafts popover. */}
          <View
            onLayout={(e) =>
              setAnchorBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)
            }
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
                  <X size={18} weight="bold" color={theme["--color-foreground"]} />
                </IconButton>
                <IconButton
                  onPress={() => setConfirmOpen(true)}
                  size={34}
                  surfaceStyle={{ backgroundColor: theme["--color-error-muted"] }}
                  accessibilityLabel={t("personas.select.deleteA11y")}
                >
                  <Trash size={18} weight="bold" color={theme["--color-error"]} />
                </IconButton>
              </Animated.View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {drafts.length > 0 ? (
                  <DraftsPill
                    count={drafts.length}
                    onPress={() => setDraftsOpen((o) => !o)}
                  />
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
                    <Plus size={18} weight="bold" color={theme["--color-foreground"]} />
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
            {/* The default Brainrot Bot, always first and always selectable so
                a user can switch back from a custom bot. It's never deletable,
                so it doesn't participate in selection (dimmed + inert there).
                layout transition lets it slide up as user rows above it leave. */}
            <Animated.View layout={LinearTransition.duration(220).easing(Easing.out(Easing.cubic))}>
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
                selectA11y={t("personas.selectA11y", { name: t("chat.agentName") })}
              />
            </Animated.View>

            {personas.map((persona) => (
              // exiting fades the row out on delete; the siblings' layout
              // transitions slide up to fill the gap — a clean animated reorder.
              <Animated.View
                key={persona.id}
                layout={LinearTransition.duration(220).easing(Easing.out(Easing.cubic))}
                exiting={FadeOut.duration(180)}
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
                  selectA11y={t("personas.selectA11y", { name: persona.displayName })}
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

          <DeleteConfirm
            open={confirmOpen}
            count={markedIds.size}
            deleting={deleting}
            onConfirm={() => void handleDeleteConfirmed()}
            onCancel={() => setConfirmOpen(false)}
          />
        </SheetTouchableProvider>
      </View>
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

// One selectable persona row: avatar + name + short description. Glass surface
// (iOS 26) with the solid card as the non-glass fallback — matching the chat
// history rows. Two distinct states ride it: `active` is the current chat
// persona (a primary edge + right-side check); `marked` is "selected for
// deletion" (a left checkbox + primary tint), shown only in selection mode and
// only for deletable (user) bots. A long-press on a deletable row seeds
// selection mode.
function PersonaRow({
  name,
  description,
  avatar,
  active,
  selectionMode = false,
  marked = false,
  deletable = false,
  onPress,
  onLongPress,
  selectA11y,
}: {
  name: string;
  description?: string;
  avatar: ReactNode;
  active: boolean;
  selectionMode?: boolean;
  marked?: boolean;
  deletable?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  selectA11y: string;
}) {
  const theme = useTheme();
  // The default bot can't be marked, so in selection mode it reads as inert —
  // dimmed and unresponsive — rather than pretending to be selectable.
  const inert = selectionMode && !deletable;
  return (
    <AppPressable
      onPress={onPress}
      onLongPress={deletable ? onLongPress : undefined}
      delayLongPress={260}
      disabled={inert}
      accessibilityLabel={selectA11y}
      accessibilityState={{ selected: selectionMode ? marked : active }}
      pressScale={0.02}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: 16,
        overflow: "hidden",
        opacity: inert ? 0.5 : 1,
      }}
    >
      {/* Glass surface where supported; solid card + border is the fallback.
          A primary tint marks the delete-selection (glass-safe — a border on a
          GlassView kills the material, so the active edge lives on the fallback
          and the glass relies on the tint + the trailing check). */}
      <GlassSurface
        pointerEvents="none"
        tintColor={marked ? theme["--color-primary-subtle"] : undefined}
        style={[StyleSheet.absoluteFillObject, { borderRadius: 16 }]}
        fallbackStyle={{
          backgroundColor: marked
            ? theme["--color-primary-subtle"]
            : theme["--color-card"],
          borderWidth: 1,
          borderColor: marked || active
            ? theme["--color-primary"]
            : theme["--color-border"],
        }}
      />

      {/* Left selection indicator — fades in/out with selection mode, only for
          deletable rows. */}
      {selectionMode && deletable ? (
        <Animated.View
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(140)}
        >
          {marked ? (
            <CheckCircle size={24} color={theme["--color-primary"]} weight="fill" />
          ) : (
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                borderWidth: 2,
                borderColor: theme["--color-foreground-muted"],
              }}
            />
          )}
        </Animated.View>
      ) : null}

      {avatar}

      {/* Layout transition slides the title as the indicator's space appears or
          disappears, instead of jumping. */}
      <Animated.View layout={LinearTransition.duration(200)} style={{ flex: 1, gap: 2 }}>
        <Typography
          variant="body"
          weight="semibold"
          numberOfLines={1}
          style={{ color: theme["--color-foreground"] }}
        >
          {name}
        </Typography>
        {description ? (
          <Typography
            variant="caption"
            numberOfLines={1}
            style={{ color: theme["--color-foreground-secondary"] }}
          >
            {description}
          </Typography>
        ) : null}
      </Animated.View>

      {/* Right "active chat persona" check — hidden in selection mode so the two
          checkmark languages never collide. */}
      <View style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }}>
        {!selectionMode && active ? (
          <Check size={20} weight="bold" color={theme["--color-primary"]} />
        ) : null}
      </View>
    </AppPressable>
  );
}

// Delete confirmation. Deletion is irreversible (the server drops the doc + its
// uploaded avatar), so we say so plainly and make "Delete" the loud,
// error-tinted action. An overlay rather than an RN <Modal> because a native
// modal can stack unpredictably over the @gorhom bottom sheet. It's teleported
// to the root portal host (the same host the sheet itself renders into, and
// pushed AFTER it, so it sits on top) — that lets the dim backdrop cover the
// FULL window instead of just the sheet's 80% bounds, which it would if it
// rendered inline in the sheet content.
function DeleteConfirm({
  open,
  count,
  deleting,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  count: number;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  if (!open) return null;

  const title =
    count === 1
      ? t("personas.select.deleteOne")
      : t("personas.select.deleteMany", { count });

  return (
    <Portal hostName="root">
    <Animated.View
      entering={FadeIn.duration(160)}
      exiting={FadeOut.duration(140)}
      style={StyleSheet.absoluteFillObject}
    >
      {/* Dim backdrop — tap to cancel (blocked while the delete is in flight). */}
      <AppPressable
        onPress={deleting ? undefined : onCancel}
        feedback="none"
        hitSlop={0}
        accessibilityLabel={t("common.cancel")}
        containerStyle={StyleSheet.absoluteFillObject}
      >
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: theme["--color-overlay"] },
          ]}
        />
      </AppPressable>

      <View
        pointerEvents="box-none"
        style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24 }}
      >
        <View
          style={{
            backgroundColor: theme["--color-card"],
            borderRadius: 20,
            padding: 22,
            gap: 10,
          }}
        >
          <Typography
            variant="title-md"
            style={{ color: theme["--color-foreground"], fontWeight: "800" }}
          >
            {title}
          </Typography>
          <Typography
            variant="body"
            style={{ color: theme["--color-foreground-secondary"] }}
          >
            {t("personas.select.warning")}
          </Typography>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "flex-end",
              gap: 12,
              marginTop: 8,
            }}
          >
            <AppPressable
              onPress={onCancel}
              disabled={deleting}
              feedback="opacity"
              accessibilityLabel={t("common.cancel")}
              style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 }}
            >
              <Typography
                variant="body"
                style={{ color: theme["--color-foreground-muted"], fontWeight: "600" }}
              >
                {t("common.cancel")}
              </Typography>
            </AppPressable>
            <AppPressable
              onPress={onConfirm}
              disabled={deleting}
              haptic
              feedback="opacity"
              accessibilityState={{ busy: deleting }}
              accessibilityLabel={t("common.delete")}
              style={{
                minWidth: 96,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderRadius: 10,
                backgroundColor: theme["--color-error"],
                opacity: deleting ? 0.85 : 1,
              }}
            >
              {deleting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Typography
                  variant="body"
                  style={{ color: "#FFFFFF", fontWeight: "800" }}
                >
                  {t("common.delete")}
                </Typography>
              )}
            </AppPressable>
          </View>
        </View>
      </View>
    </Animated.View>
    </Portal>
  );
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
function DraftsPill({ count, onPress }: { count: number; onPress: () => void }) {
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

