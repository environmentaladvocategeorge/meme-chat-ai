import { create } from "zustand";

// Drives the global Plan & Usage bottom sheet (mounted once in the (app)
// layout). Any upgrade CTA — chat usage nudges, the quota modal, the settings
// row — opens it via useOpenPlan() so the paywall surfaces in place rather
// than navigating away.
type PlanSheetState = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

export const usePlanSheetStore = create<PlanSheetState>()((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
