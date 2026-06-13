import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMemo } from "react";
import { create } from "zustand";
import {
  DEFAULT_PERSONA_ID,
  resolveSelectedPersona,
  type ResolvedPersona,
  type UserPersonaSummary,
} from "@/domain/personas";
import { fetchUserPersonas } from "@/services/firebase/personas";

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
  // Reads the persisted selection. Called early at startup, alongside the other
  // store hydrate()s, so the header shows the right persona before the list
  // (which validates it) has loaded.
  hydrateSelection: () => Promise<void>;
  // Fetches the signed-in user's saved personas for the picker list.
  hydrate: (uid: string) => Promise<void>;
  select: (personaId: string) => void;
  // Sign-out teardown: back to the default, drop the list, forget the persisted
  // pick so the next user on this device never inherits it.
  clear: () => void;
};

export const usePersonaStore = create<PersonaState>()((set, get) => ({
  selectedPersonaId: DEFAULT_PERSONA_ID,
  personas: [],
  status: "idle",

  hydrateSelection: async () => {
    try {
      const stored = await AsyncStorage.getItem(SELECTED_KEY);
      if (stored) set({ selectedPersonaId: stored });
    } catch {
      // Selection is non-critical — fall back to the default on a read error.
    }
  },

  hydrate: async (uid) => {
    set({ status: "loading" });
    try {
      const personas = await fetchUserPersonas(uid);
      set({ personas, status: "ready" });
    } catch {
      // Leave the existing list intact-as-empty and surface the error state;
      // the picker still works (default + create), and the header falls back.
      set({ status: "error" });
    }
  },

  select: (personaId) => {
    if (get().selectedPersonaId === personaId) return;
    set({ selectedPersonaId: personaId });
    AsyncStorage.setItem(SELECTED_KEY, personaId).catch(() => {});
  },

  clear: () => {
    set({ selectedPersonaId: DEFAULT_PERSONA_ID, personas: [], status: "idle" });
    AsyncStorage.removeItem(SELECTED_KEY).catch(() => {});
  },
}));

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
