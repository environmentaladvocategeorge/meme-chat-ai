import i18n from "@/i18n";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { create } from "zustand";

// Show notifications even while the app is foregrounded (the daily rot-check can
// land while the user is mid-chat). Set once at module load.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Stable identifier for the single recurring daily notification, so re-running
// the sync replaces (rather than stacks) it and revoking permission can tear it
// down by id.
const DAILY_ROT_CHECK_ID = "daily-rot-check";
const DAILY_ROT_CHECK_CHANNEL = "daily-rot-check";
const DAILY_ROT_CHECK_HOUR = 16; // 4pm, user local time

// Keep the daily "are we rotting today?" notification in lockstep with the OS
// permission: scheduled (once) when granted, cancelled when not. Idempotent —
// safe to call on every permission read. Best-effort; never throws.
async function syncDailyRotCheck(permission: NotificationPermission): Promise<void> {
  if (!Device.isDevice) return;
  try {
    // Always clear the prior schedule first: prevents duplicates and, when
    // permission is gone, leaves nothing behind.
    await Notifications.cancelScheduledNotificationAsync(DAILY_ROT_CHECK_ID).catch(
      () => {},
    );
    if (permission !== "granted") return;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(DAILY_ROT_CHECK_CHANNEL, {
        name: "Daily rot check",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    await Notifications.scheduleNotificationAsync({
      identifier: DAILY_ROT_CHECK_ID,
      content: {
        title: i18n.t("systemNotifications.dailyRotCheck.title"),
        body: i18n.t("systemNotifications.dailyRotCheck.body"),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: DAILY_ROT_CHECK_HOUR,
        minute: 0,
        ...(Platform.OS === "android"
          ? { channelId: DAILY_ROT_CHECK_CHANNEL }
          : null),
      },
    });
  } catch {
    // Scheduling is best-effort — a failure here must never break onboarding,
    // settings, or app start.
  }
}

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
      void syncDailyRotCheck(permission);
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
      void syncDailyRotCheck(permission);
      return permission;
    } catch {
      set({ permission: "denied" });
      return "denied";
    }
  },

  decline: () => set({ optIn: "declined" }),
}));
