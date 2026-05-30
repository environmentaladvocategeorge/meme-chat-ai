import { create } from "zustand";

// Drives the global Customize Chat bottom sheet (mounted once in the root
// layout). The settings "Customize Chat" row opens it via useOpenChat
// Customization() so the picker surfaces in place rather than crowding the
// settings page.
type ChatCustomizationSheetState = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

export const useChatCustomizationSheetStore =
  create<ChatCustomizationSheetState>()((set) => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
  }));
