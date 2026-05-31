import { create } from "zustand";

// Drives the global Rot Level bottom sheet (mounted once in the root layout,
// outside the iPad content column so the sheet spans the full screen width).
// The chat composer's RotLevelButton opens it via open().
type RotLevelSheetState = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

export const useRotLevelSheetStore = create<RotLevelSheetState>()((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
