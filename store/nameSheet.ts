import { create } from "zustand";

// Drives the global Nickname bottom sheet (mounted once in the root layout).
// The settings "Nickname" preference row opens it via open(). The nickname used
// to live inside the Account sheet, but it's a personalization preference rather
// than an account/security concern, so it sits in Settings → Preferences now.
type NameSheetState = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

export const useNameSheetStore = create<NameSheetState>()((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
