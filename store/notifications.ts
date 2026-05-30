import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { create } from "zustand";

// The OS-level permission status, normalized to the three states we care about.
export type NotificationPermission = "undetermined" | "granted" | "denied";

// The user's explicit onboarding choice, kept separate from the OS status: the
// notification pre-prompt records whether they tapped "allow" (which triggers
// the native dialog) or "nah, let me rot in silence" (which skips it). This
// lets the flow advance either way without re-prompting.
export type NotificationOptIn = "unset" | "allowed" | "declined";

interface NotificationsState {
  permission: NotificationPermission;
  optIn: NotificationOptIn;
  // Reads the current OS permission without prompting. Safe to call on mount.
  refresh: () => Promise<NotificationPermission>;
  // Triggers the native permission dialog (no-op on a non-device/simulator
  // without notification support). Records optIn = "allowed".
  requestPermission: () => Promise<NotificationPermission>;
  // The "let me rot in silence" path — records the decline without touching
  // the OS so we can offer to ask again later.
  decline: () => void;
}

function normalize(status: Notifications.PermissionStatus): NotificationPermission {
  if (status === "granted") return "granted";
  if (status === "denied") return "denied";
  return "undetermined";
}

export const useNotificationsStore = create<NotificationsState>()((set) => ({
  permission: "undetermined",
  optIn: "unset",

  refresh: async () => {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      const permission = normalize(status);
      set({ permission });
      return permission;
    } catch {
      return "undetermined";
    }
  },

  requestPermission: async () => {
    set({ optIn: "allowed" });
    // Permissions can't be granted on a simulator/emulator without a real
    // device; bail gracefully so onboarding still advances.
    if (!Device.isDevice) {
      set({ permission: "denied" });
      return "denied";
    }
    try {
      const existing = await Notifications.getPermissionsAsync();
      let status = existing.status;
      if (status !== "granted") {
        const requested = await Notifications.requestPermissionsAsync();
        status = requested.status;
      }
      const permission = normalize(status);
      set({ permission });
      return permission;
    } catch {
      set({ permission: "denied" });
      return "denied";
    }
  },

  decline: () => set({ optIn: "declined" }),
}));
