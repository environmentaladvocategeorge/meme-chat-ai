// Tiny ephemeral store for the playful nav menu's open state.
//
// Lives in a store (not React context) so the menu button (rendered inline
// by AppHeader on each screen) and the overlay (mounted once in the (app)
// layout) can both read and mutate the open flag without one having to be
// a descendant of the other.

import { create } from "zustand";

interface MenuState {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

export const useMenuStore = create<MenuState>()((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}));
