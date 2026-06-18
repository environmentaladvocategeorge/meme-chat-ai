import i18n from "@/i18n";
import { usePersonaStore } from "@/store/personas";
import * as Device from "expo-device";
import * as FileSystem from "expo-file-system/legacy";
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

// Identifier prefix for the daily rot-check notifications. We schedule one
// WEEKLY notification per weekday (id `${PREFIX}-${weekday}`) rather than a
// single recurring DAILY one, so each day of the week can carry a different bot
// and a different line. The prefix lets the sync tear down the whole set (and
// the old single-id schedule from before this change) before re-arming.
const DAILY_ROT_CHECK_PREFIX = "daily-rot-check";
const DAILY_ROT_CHECK_CHANNEL = "daily-rot-check";
const DAILY_ROT_CHECK_HOUR = 16; // 4pm, user local time
// expo weekday numbering: 1 = Sunday … 7 = Saturday.
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

// A bot that can front the daily nudge: the localized default mascot, or one of
// the user's saved personas (which may carry an uploaded avatar).
type NotifBot = { name: string; avatarUrl?: string };

function shuffle<T>(input: readonly T[]): T[] {
  const out = input.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The pool the daily nudge draws from: the default Brainrot Bot plus every
// custom persona the signed-in user has saved (read live from the persona
// store). Keeping the mascot in the pool means a user with no custom bots still
// gets a sensible name, and the original character stays in the rotation.
function buildBotPool(): NotifBot[] {
  const defaultBot: NotifBot = {
    name: i18n.t("systemNotifications.dailyRotCheck.defaultBotName"),
  };
  const personas = usePersonaStore.getState().personas;
  const custom = personas.map((p) => ({ name: p.displayName, avatarUrl: p.avatarUrl }));
  return [defaultBot, ...custom];
}

// How many rotating bodies the active locale defines (English fallback applies).
function bodyCount(): number {
  const raw = i18n.t("systemNotifications.dailyRotCheck.bodies", {
    returnObjects: true,
  }) as unknown;
  return Array.isArray(raw) ? raw.length : 0;
}

// Render one rotating body with the bot's name filled in. Lets i18next do the
// {{botName}} interpolation via indexed key access (bodies.N), and falls back to
// a single hardcoded line if the locale lookup ever returns nothing, so a bad
// resource can't leave the user with no daily nudge.
function renderBody(index: number, botName: string): string {
  if (index < 0) return `${botName} here. are we rotting today?`;
  return i18n.t(`systemNotifications.dailyRotCheck.bodies.${index}`, { botName });
}

// Tiny stable hash (djb2) so a given avatar URL always maps to the same cache
// file — lets us skip the download when we've already pulled that avatar.
function hashUrl(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = (h * 33) ^ url.charCodeAt(i);
  return (h >>> 0).toString(36);
}

// Download the avatar to a stable per-URL cache file once, reusing it on later
// syncs. This file is never attached directly (see avatarAttachmentUri) — only
// copied from — so iOS can't move it out from under us.
async function ensureCachedAvatar(avatarUrl: string): Promise<string | undefined> {
  const target = `${FileSystem.cacheDirectory}rotcheck-avatar-${hashUrl(avatarUrl)}.jpg`;
  const info = await FileSystem.getInfoAsync(target);
  if (info.exists) return info.uri;
  const { uri } = await FileSystem.downloadAsync(avatarUrl, target);
  return uri;
}

// iOS local notifications can show a thumbnail via an attachment, but it needs a
// local file, and the system MOVES that file into its own store at schedule
// time. So we hand each weekday its own fresh copy of the cached avatar —
// otherwise two days sharing one bot would leave the second day imageless.
// Best-effort: any failure just drops the image and the notification still goes
// out with the bot's name. Android has no largeIcon hook in expo-notifications,
// so we never call this there.
async function avatarAttachmentUri(
  avatarUrl: string | undefined,
  weekday: number,
): Promise<string | undefined> {
  if (!avatarUrl) return undefined;
  try {
    const cached = await ensureCachedAvatar(avatarUrl);
    if (!cached) return undefined;
    const copy = `${FileSystem.cacheDirectory}rotcheck-attach-${weekday}-${hashUrl(avatarUrl)}.jpg`;
    await FileSystem.deleteAsync(copy, { idempotent: true });
    await FileSystem.copyAsync({ from: cached, to: copy });
    return copy;
  } catch {
    return undefined;
  }
}

// Cancel the whole daily rot-check set (every per-weekday id plus the legacy
// single id from before this change), leaving nothing behind when permission is
// gone and no duplicates before a re-arm.
async function cancelDailyRotChecks(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.identifier?.startsWith(DAILY_ROT_CHECK_PREFIX))
        .map((n) =>
          Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {}),
        ),
    );
  } catch {
    // Best-effort — a listing/cancel failure must never break the caller.
  }
}

// Keep the daily "are we rotting today?" notifications in lockstep with the OS
// permission: a fresh weekly rotation (one per weekday, each a random bot + a
// random line) when granted, nothing when not. Idempotent and best-effort —
// safe to call on every permission read or persona-list change.
async function syncDailyRotChecks(permission: NotificationPermission): Promise<void> {
  if (!Device.isDevice) return;
  try {
    // Always clear the prior schedule first: prevents duplicates and, when
    // permission is gone, leaves nothing behind.
    await cancelDailyRotChecks();
    if (permission !== "granted") return;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(DAILY_ROT_CHECK_CHANNEL, {
        name: "Daily rot check",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    // Spread bots and lines across the week so consecutive days don't repeat
    // while either pool is large enough; they cycle for smaller pools.
    const bots = shuffle(buildBotPool());
    const count = bodyCount();
    const lineOrder = shuffle(Array.from({ length: count }, (_, n) => n));

    for (let i = 0; i < WEEKDAYS.length; i++) {
      const weekday = WEEKDAYS[i];
      const bot = bots[i % bots.length];
      const lineIndex = count > 0 ? lineOrder[i % lineOrder.length] : -1;
      const body = renderBody(lineIndex, bot.name);
      // Avatar download/copy is wrapped to swallow its own errors, but guard
      // again here so a surprise rejection can't abort the whole week's schedule.
      const avatarUri =
        Platform.OS === "ios"
          ? await avatarAttachmentUri(bot.avatarUrl, weekday).catch(() => undefined)
          : undefined;

      await Notifications.scheduleNotificationAsync({
        identifier: `${DAILY_ROT_CHECK_PREFIX}-${weekday}`,
        content: {
          title: bot.name,
          body,
          ...(avatarUri
            ? { attachments: [{ identifier: "avatar", url: avatarUri, type: null }] }
            : null),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday,
          hour: DAILY_ROT_CHECK_HOUR,
          minute: 0,
          ...(Platform.OS === "android"
            ? { channelId: DAILY_ROT_CHECK_CHANNEL }
            : null),
        },
      });
    }
  } catch {
    // The fancy rotation (custom bots + avatars) failed for some reason. Don't
    // leave the user with no daily nudge: fall back to the plain rotating-text
    // schedule, which uses only i18n strings and the simplest trigger.
    await scheduleFallbackRotChecks(permission).catch(() => {});
  }
}

// The safety net. The primary schedule reads the persona store, downloads
// avatars, and uses iOS attachments — any of which could in theory throw. This
// fallback strips all of that: default mascot name, rotating i18n text only, the
// plainest weekly trigger, no avatars, no persona access. Each weekday is
// scheduled independently so one failure can't sink the rest, and the whole
// thing is best-effort, so even total failure just means no daily nudge (never a
// crash). Assumes the caller already cleared the prior schedule.
async function scheduleFallbackRotChecks(permission: NotificationPermission): Promise<void> {
  if (!Device.isDevice || permission !== "granted") return;
  let name = "Brainrot Bot";
  let count = 0;
  try {
    name = i18n.t("systemNotifications.dailyRotCheck.defaultBotName");
    count = bodyCount();
  } catch {
    // Stick with the hardcoded defaults if even the i18n read throws.
  }
  const lineOrder = shuffle(Array.from({ length: count }, (_, n) => n));

  for (let i = 0; i < WEEKDAYS.length; i++) {
    const weekday = WEEKDAYS[i];
    try {
      const lineIndex = count > 0 ? lineOrder[i % lineOrder.length] : -1;
      await Notifications.scheduleNotificationAsync({
        identifier: `${DAILY_ROT_CHECK_PREFIX}-${weekday}`,
        content: { title: name, body: renderBody(lineIndex, name) },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday,
          hour: DAILY_ROT_CHECK_HOUR,
          minute: 0,
          ...(Platform.OS === "android"
            ? { channelId: DAILY_ROT_CHECK_CHANNEL }
            : null),
        },
      });
    } catch {
      // Skip this day, keep trying the rest.
    }
  }
}

// Serialize syncs: refresh(), requestPermission(), and the persona-list
// subscription can all fire close together, and we don't want a cancel from one
// run racing a schedule from another. Each call queues behind the last.
let syncChain: Promise<void> = Promise.resolve();
function queueSync(permission: NotificationPermission): Promise<void> {
  syncChain = syncChain.then(() => syncDailyRotChecks(permission)).catch(() => {});
  return syncChain;
}

// Re-arm the rotation when the user's saved bots change — most importantly when
// the list finishes hydrating after sign-in (refresh() often runs first, with
// only the default in the pool), but also when they create or delete a bot.
// One-directional dependency (this store reads the persona store, never the
// reverse), so there's no import cycle.
usePersonaStore.subscribe((state, prev) => {
  try {
    if (state.personas === prev.personas) return;
    const permission = useNotificationsStore.getState().permission;
    if (permission === "granted") void queueSync(permission);
  } catch {
    // A subscriber that throws would bubble into whatever persona-store update
    // triggered it. Never let a notification re-arm break bot create/delete.
  }
});

// Sign-out / account-deletion teardown. Cancels the whole scheduled daily
// rot-check set — those notifications carry the user's saved bot names (and, on
// iOS, their avatars), so after deletion the device must stop firing them. Also
// drops the in-memory onboarding opt-in so the next user re-chooses. The OS
// permission itself is device-level (not the deleted user's data) and is left
// untouched — refresh() re-reads it and re-arms on the next sign-in.
export async function teardownUserNotifications(): Promise<void> {
  await cancelDailyRotChecks().catch(() => {});
  try {
    useNotificationsStore.setState({ optIn: "unset" });
  } catch {
    // Never let teardown throw into the deletion flow.
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
      void queueSync(permission);
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
      void queueSync(permission);
      return permission;
    } catch {
      set({ permission: "denied" });
      return "denied";
    }
  },

  decline: () => set({ optIn: "declined" }),
}));
