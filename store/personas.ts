import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMemo } from "react";
import { create } from "zustand";
import {
  DEFAULT_PERSONA_ID,
  isFirstPartyPersonaId,
  resolveSelectedPersona,
  type ResolvedPersona,
  type UserPersonaSummary,
} from "@/domain/personas";
import { fetchUserPersonas } from "@/services/firebase/personas";
import { EditAvatarCandidatesStorage } from "@/store/storage";

// Local persona state: which persona the user chats as, plus their hydrated
// list of saved personas for the picker. Selection is LOCAL and device-scoped
// (persisted via AsyncStorage); the list is fetched from user_personas on
// sign-in. The default is Brainrot Bot — any user who has never picked one
// chats as the default, and a selected-but-missing persona (deleted on another
// device) falls back to it at resolve time (see resolveSelectedPersona).

const SELECTED_KEY = "app.persona.selectedId";

type PersonaListStatus = "idle" | "loading" | "ready" | "error";

type PersonaState = {
  selectedPersonaId: string;
  personas: UserPersonaSummary[];
  status: PersonaListStatus;
  // True once hydrateSelection() has finished reading the persisted pick. Until
  // then the chat header shows a loading pill instead of guessing the default —
  // otherwise a returning user with a saved bot flashes Brainrot Bot before the
  // restore + list resolve. See usePersonaSelectionReady.
  selectionHydrated: boolean;
  // Reads the persisted selection. Called early at startup, alongside the other
  // store hydrate()s, so the header shows the right persona before the list
  // (which validates it) has loaded.
  hydrateSelection: () => Promise<void>;
  // Fetches the signed-in user's saved personas for the picker list.
  hydrate: (uid: string) => Promise<void>;
  select: (personaId: string) => void;
  // Drop personas from the local list after a successful server delete. If the
  // currently-chatted persona was among them, fall back to the default (and
  // re-persist) so the chat header never strands on a bot that's gone.
  removeMany: (ids: string[]) => void;
  // Sign-out teardown: back to the default, drop the list, forget the persisted
  // pick so the next user on this device never inherits it.
  clear: () => void;
};

export const usePersonaStore = create<PersonaState>()((set, get) => ({
  selectedPersonaId: DEFAULT_PERSONA_ID,
  personas: [],
  status: "idle",
  selectionHydrated: false,

  hydrateSelection: async () => {
    try {
      const stored = await AsyncStorage.getItem(SELECTED_KEY);
      if (stored) set({ selectedPersonaId: stored });
    } catch {
      // Selection is non-critical — fall back to the default on a read error.
    } finally {
      set({ selectionHydrated: true });
    }
  },

  hydrate: async (uid) => {
    set({ status: "loading" });
    try {
      const personas = await fetchUserPersonas(uid);
      set({ personas, status: "ready" });
    } catch (err) {
      // Leave the existing list intact-as-empty and surface the error state;
      // the picker still works (default + create), and the header falls back.
      // Log it: a silent catch here once hid a permission-denied (the
      // user_personas read rule wasn't deployed), which read as "my bots
      // vanished" with no trace. A Firestore permission-denied here almost
      // always means the rules aren't deployed or the ID token's
      // email_verified claim is stale.
      console.warn("[personas] hydrate failed:", err);
      set({ status: "error" });
    }
  },

  select: (personaId) => {
    if (get().selectedPersonaId === personaId) return;
    set({ selectedPersonaId: personaId });
    AsyncStorage.setItem(SELECTED_KEY, personaId).catch(() => {});
  },

  removeMany: (ids) => {
    if (ids.length === 0) return;
    const drop = new Set(ids);
    const wasSelected = drop.has(get().selectedPersonaId);
    set((s) => ({
      personas: s.personas.filter((p) => !drop.has(p.id)),
      ...(wasSelected ? { selectedPersonaId: DEFAULT_PERSONA_ID } : {}),
    }));
    if (wasSelected) AsyncStorage.setItem(SELECTED_KEY, DEFAULT_PERSONA_ID).catch(() => {});
    // Drop any locally-stored AI avatar candidate pairs for the deleted personas
    // so the map doesn't accumulate entries for bots that no longer exist.
    void EditAvatarCandidatesStorage.removeFor(ids);
  },

  clear: () => {
    set({ selectedPersonaId: DEFAULT_PERSONA_ID, personas: [], status: "idle" });
    AsyncStorage.removeItem(SELECTED_KEY).catch(() => {});
  },
}));

// Whether the selected persona can be shown for real (vs. a loading placeholder).
// True when the persisted pick has been read AND — if it points at a user bot —
// the list it lives in has settled (ready/error). A pick of the default needs no
// list, so it's ready the moment the persisted read finishes. This is what stops
// the "Brainrot Bot → your bot" flash on cold start for a returning user.
export function usePersonaSelectionReady(): boolean {
  const selectionHydrated = usePersonaStore((s) => s.selectionHydrated);
  const selectedPersonaId = usePersonaStore((s) => s.selectedPersonaId);
  const personas = usePersonaStore((s) => s.personas);
  const status = usePersonaStore((s) => s.status);
  if (!selectionHydrated) return false;
  if (selectedPersonaId === DEFAULT_PERSONA_ID) return true;
  // Curated first-party bots (e.g. Luna) are statically known, so they resolve
  // immediately like the default — no need to wait on the user-list fetch.
  if (isFirstPartyPersonaId(selectedPersonaId)) return true;
  // The selected bot is already loaded — resolvable now, even if a background
  // re-hydrate is in flight (so creating/editing a bot or a foreground refresh
  // never flashes the skeleton back over an already-known pick).
  if (personas.some((p) => p.id === selectedPersonaId)) return true;
  // Not in the list yet: still resolving until the list has actually settled
  // (then resolveSelectedPersona applies the default fallback if it's missing).
  return status === "ready" || status === "error";
}

// The resolved active persona (default or a hydrated user persona), with the
// deleted-elsewhere fallback applied. Drives the chat header pill + the
// picker's hero.
export function useSelectedPersona(): ResolvedPersona {
  const selectedPersonaId = usePersonaStore((s) => s.selectedPersonaId);
  const personas = usePersonaStore((s) => s.personas);
  return useMemo(
    () => resolveSelectedPersona(selectedPersonaId, personas),
    [selectedPersonaId, personas],
  );
}
