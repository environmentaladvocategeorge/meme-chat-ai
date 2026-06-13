import { create } from "zustand";

// Drives the global Persona picker sheet (mounted once in the root layout).
// The chat header's persona pill opens it via open(); selecting a persona (or
// the close button) dismisses it. Mirrors useNameSheetStore — a minimal
// open/close flag, no view state, since the picker is a single screen.
type PersonaSheetState = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

export const usePersonaSheetStore = create<PersonaSheetState>()((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
