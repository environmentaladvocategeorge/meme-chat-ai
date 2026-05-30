import { usePlanSheetStore } from "@/store/planSheet";

// Single entry point for "show me Plan & Usage". Every upgrade CTA in the app
// (chat usage nudges, the quota modal, the settings row) routes through here,
// opening the global bottom sheet in place rather than navigating away.
export function useOpenPlan(): () => void {
  return usePlanSheetStore((s) => s.open);
}
