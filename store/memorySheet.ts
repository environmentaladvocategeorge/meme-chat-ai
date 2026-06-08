import { create } from "zustand";

// Drives the global Memory bottom sheet (mounted once in the root layout so it
// spans the full screen width and stays centered on wide screens). The settings
// Memory row opens it via open().
type MemorySheetState = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

export const useMemorySheetStore = create<MemorySheetState>()((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
