import * as Haptics from "expo-haptics";

// Light tactile tap for primary icon buttons (menu, new chat, photo, menu
// pills). Fire-and-forget and fully guarded: the try/catch swallows a
// synchronous throw (e.g. the native module missing on an OTA'd binary) and
// the .catch swallows the async rejection (no haptics engine / web). A tap
// must never fail because feedback failed.
export function tapHaptic() {
  try {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  } catch {
    // no-op
  }
}
