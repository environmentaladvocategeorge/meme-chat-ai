import { useMemo } from "react";
import { create } from "zustand";
import {
  canCreateDraft,
  createDraft,
  removeDraft,
  upsertDraft,
  type MediaPick,
  type PersonaDraft,
  type PersonaDraftAvatar,
} from "@/domain/personaDrafts";
import type { PersonaFormValues } from "@/domain/personaForm";
import type { PickedAvatar } from "@/services/firebase/uploadPersonaAvatar";
import { PersonaDraftsStorage } from "@/store/storage";

// Local persona-draft state for the creator. Drafts live on-device only (see
// PersonaDraftsStorage). There is NO autosave: a working draft is held in
// memory and only written to disk when the user explicitly picks "Save draft"
// (saveNow). newDraft seeds an in-memory working draft; updateActive mutates it
// in memory; abandonActive throws away unsaved changes; discard deletes a saved
// draft. A user keeps at most MAX_PERSONA_DRAFTS saved drafts.

type PersonaDraftState = {
  drafts: PersonaDraft[];
  // Ids of drafts that actually exist ON DISK. A freshly-created working draft
  // is in `drafts` (so the creator can render it) but NOT here until the user
  // explicitly saves — which is what the drafts pill/popover count, so opening
  // the creator never pre-emptively bumps "Drafts (1)".
  savedIds: string[];
  activeId: string | null;
  hydrated: boolean;
  // Load persisted drafts (called once at startup, like the other stores).
  hydrate: () => Promise<void>;
  // Start a working draft from a template (or scratch). Held in memory only —
  // nothing hits disk until saveNow. Returns its id, or null when already at the
  // cap (the caller shows "finish or delete one").
  newDraft: (templateId?: string | null) => string | null;
  open: (id: string) => void;
  closeActive: () => void;
  // In-memory edit to the active draft (no persistence — explicit save only).
  updateActive: (patch: {
    values?: PersonaFormValues;
    step?: number;
    avatar?: PersonaDraftAvatar | null;
    mediaPicks?: MediaPick[];
    generatedAvatars?: PickedAvatar[];
  }) => void;
  // Persist the current in-memory drafts to disk ("Save draft").
  saveNow: () => Promise<void>;
  // Throw away unsaved changes on the active draft and clear it: a never-saved
  // draft vanishes, an edited saved draft reverts to its last-saved version.
  // Reverts by re-reading disk, so it's non-destructive to saved drafts.
  abandonActive: () => Promise<void>;
  // Delete a saved draft from memory + disk (the drafts list's discard).
  discard: (id: string) => void;
};

export const usePersonaDraftStore = create<PersonaDraftState>()((set, get) => ({
  drafts: [],
  savedIds: [],
  activeId: null,
  hydrated: false,

  hydrate: async () => {
    const drafts = await PersonaDraftsStorage.read();
    set({ drafts, savedIds: drafts.map((d) => d.id), hydrated: true });
  },

  newDraft: (templateId) => {
    const { drafts } = get();
    if (!canCreateDraft(drafts)) return null;
    const draft = createDraft(templateId ?? null);
    // In memory only — not written (and NOT added to savedIds) until the user
    // explicitly saves, so the drafts pill stays put when opening the creator.
    set({ drafts: upsertDraft(drafts, draft), activeId: draft.id });
    return draft.id;
  },

  open: (id) => set({ activeId: id }),

  closeActive: () => set({ activeId: null }),

  updateActive: ({ values, step, avatar, mediaPicks, generatedAvatars }) => {
    const { activeId, drafts } = get();
    if (!activeId) return;
    const current = drafts.find((d) => d.id === activeId);
    if (!current) return;
    const updated: PersonaDraft = {
      ...current,
      values: values ?? current.values,
      step: step ?? current.step,
      avatar: avatar !== undefined ? avatar : current.avatar,
      mediaPicks: mediaPicks ?? current.mediaPicks,
      generatedAvatars: generatedAvatars ?? current.generatedAvatars,
    };
    // Memory only; upsertDraft re-stamps updatedAt + keeps it at the front.
    set({ drafts: upsertDraft(drafts, updated) });
  },

  saveNow: async () => {
    const { drafts } = get();
    await PersonaDraftsStorage.write(drafts);
    // Everything in memory is now on disk → all ids count as saved.
    set({ savedIds: drafts.map((d) => d.id) });
  },

  abandonActive: async () => {
    // Re-read disk so unsaved changes (and never-saved drafts) drop, while any
    // previously-saved drafts are restored untouched.
    const drafts = await PersonaDraftsStorage.read();
    set({ drafts, savedIds: drafts.map((d) => d.id), activeId: null });
  },

  discard: (id) => {
    const { drafts, savedIds, activeId } = get();
    const next = removeDraft(drafts, id);
    set({
      drafts: next,
      savedIds: savedIds.filter((s) => s !== id),
      activeId: activeId === id ? null : activeId,
    });
    void PersonaDraftsStorage.write(next);
  },
}));

// The active draft, or null. Hook for the creator to read its working draft.
export function useActiveDraft(): PersonaDraft | null {
  const activeId = usePersonaDraftStore((s) => s.activeId);
  const drafts = usePersonaDraftStore((s) => s.drafts);
  return drafts.find((d) => d.id === activeId) ?? null;
}

// Only the drafts the user has actually saved to disk — what the drafts pill +
// popover show. Excludes a freshly-created working draft that's still in memory,
// so opening the creator doesn't make "Drafts (1)" appear before any save.
export function useSavedDrafts(): PersonaDraft[] {
  const drafts = usePersonaDraftStore((s) => s.drafts);
  const savedIds = usePersonaDraftStore((s) => s.savedIds);
  return useMemo(() => {
    const saved = new Set(savedIds);
    return drafts.filter((d) => saved.has(d.id));
  }, [drafts, savedIds]);
}
