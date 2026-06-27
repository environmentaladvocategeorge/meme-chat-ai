import { create } from "zustand";

// Drives the global Account bottom sheet (mounted once in the root layout).
// The settings "Account" row opens it via open(); the hub's rows switch the
// active `view` in place so the whole account flow surfaces as a paywall-style
// bottom sheet instead of pushing full-screen stack pages.
export type AccountSheetView =
  | "hub"
  | "change-email"
  | "change-password"
  | "reset-password"
  | "delete-account";

type AccountSheetState = {
  isOpen: boolean;
  view: AccountSheetView;
  // Locks dismissal (pan-down + close button) while an irreversible action is
  // mid-flight — currently account deletion — so the teardown can finish
  // uninterrupted.
  busy: boolean;
  open: (view?: AccountSheetView) => void;
  navigate: (view: AccountSheetView) => void;
  setBusy: (busy: boolean) => void;
  close: () => void;
};

export const useAccountSheetStore = create<AccountSheetState>()((set) => ({
  isOpen: false,
  view: "hub",
  busy: false,
  open: (view = "hub") => set({ isOpen: true, view, busy: false }),
  navigate: (view) => set({ view }),
  setBusy: (busy) => set({ busy }),
  close: () => set({ isOpen: false, busy: false }),
}));
