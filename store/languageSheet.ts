import { create } from "zustand";

type LanguageSheetState = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

export const useLanguageSheetStore = create<LanguageSheetState>()((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
