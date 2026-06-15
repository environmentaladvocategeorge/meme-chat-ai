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
import { PersonaDraftsStorage } from "@/store/storage";

// Local persona-draft state for the creator. Drafts live on-device only (see
// PersonaDraftsStorage). There is NO autosave: a working draft is held in
// memory and only written to disk when the user explicitly picks "Save draft"
// (saveNow). newDraft seeds an in-memory working draft; updateActive mutates it
// in memory; abandonActive throws away unsaved changes; discard deletes a saved
// draft. A user keeps at most MAX_PERSONA_DRAFTS saved drafts.

type PersonaDraftState = {
  drafts: PersonaDraft[];
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
  activeId: null,
  hydrated: false,

  hydrate: async () => {
    const drafts = await PersonaDraftsStorage.read();
    set({ drafts, hydrated: true });
  },

  newDraft: (templateId) => {
    const { drafts } = get();
    if (!canCreateDraft(drafts)) return null;
    const draft = createDraft(templateId ?? null);
    // In memory only — not written until the user explicitly saves.
    set({ drafts: upsertDraft(drafts, draft), activeId: draft.id });
    return draft.id;
  },

  open: (id) => set({ activeId: id }),

  closeActive: () => set({ activeId: null }),

  updateActive: ({ values, step, avatar, mediaPicks }) => {
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
    };
    // Memory only; upsertDraft re-stamps updatedAt + keeps it at the front.
    set({ drafts: upsertDraft(drafts, updated) });
  },

  saveNow: async () => {
    await PersonaDraftsStorage.write(get().drafts);
  },

  abandonActive: async () => {
    // Re-read disk so unsaved changes (and never-saved drafts) drop, while any
    // previously-saved drafts are restored untouched.
    const drafts = await PersonaDraftsStorage.read();
    set({ drafts, activeId: null });
  },

  discard: (id) => {
    const { drafts, activeId } = get();
    const next = removeDraft(drafts, id);
    set({ drafts: next, activeId: activeId === id ? null : activeId });
    void PersonaDraftsStorage.write(next);
  },
}));

// The active draft, or null. Hook for the creator to read its working draft.
export function useActiveDraft(): PersonaDraft | null {
  const activeId = usePersonaDraftStore((s) => s.activeId);
  const drafts = usePersonaDraftStore((s) => s.drafts);
  return drafts.find((d) => d.id === activeId) ?? null;
}
