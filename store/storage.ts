import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  BACKGROUND_IDS,
  BUBBLE_STYLE_IDS,
  DEFAULT_BACKGROUND,
  DEFAULT_BUBBLE_STYLE,
} from "@/domain/customization";

export type Appearance = "system" | "light" | "dark";
export type Language = "system" | "en" | "es";

export interface PersistedSettings {
  appearance: Appearance;
  language: Language;
  // Paid "App Customization" feature. Stored as preset ids (or "auto").
  // Local-only — never synced to the backend.
  chatBubbleStyle: string;
  chatBackground: string;
  // The name Brainrot Bot calls the user, captured during onboarding. Mirrored to
  // profiles/{uid} via the updateProfile callable so it survives reinstall;
  // this local copy is the fast read for the UI.
  alias: string;
}

export const MAX_ALIAS_LENGTH = 40;

const SETTINGS_KEY = "app.settings";
const ONBOARDING_KEY = "app.onboarding";

const APPEARANCE_VALUES = new Set<Appearance>(["system", "light", "dark"]);
const LANGUAGE_VALUES = new Set<Language>(["system", "en", "es"]);
const BUBBLE_STYLE_VALUES = new Set<string>(BUBBLE_STYLE_IDS);
const BACKGROUND_VALUES = new Set<string>(BACKGROUND_IDS);

export const DEFAULT_SETTINGS: PersistedSettings = {
  appearance: "system",
  language: "system",
  chatBubbleStyle: DEFAULT_BUBBLE_STYLE,
  chatBackground: DEFAULT_BACKGROUND,
  alias: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeSettings(value: unknown): PersistedSettings {
  if (!isRecord(value)) return DEFAULT_SETTINGS;

  return {
    appearance:
      typeof value.appearance === "string" &&
      APPEARANCE_VALUES.has(value.appearance as Appearance)
        ? (value.appearance as Appearance)
        : DEFAULT_SETTINGS.appearance,
    language:
      typeof value.language === "string" &&
      LANGUAGE_VALUES.has(value.language as Language)
        ? (value.language as Language)
        : DEFAULT_SETTINGS.language,
    chatBubbleStyle:
      typeof value.chatBubbleStyle === "string" &&
      BUBBLE_STYLE_VALUES.has(value.chatBubbleStyle)
        ? value.chatBubbleStyle
        : DEFAULT_SETTINGS.chatBubbleStyle,
    chatBackground:
      typeof value.chatBackground === "string" &&
      BACKGROUND_VALUES.has(value.chatBackground)
        ? value.chatBackground
        : DEFAULT_SETTINGS.chatBackground,
    alias:
      typeof value.alias === "string"
        ? value.alias.slice(0, MAX_ALIAS_LENGTH)
        : DEFAULT_SETTINGS.alias,
  };
}

let pendingSettingsWrite = Promise.resolve();

export const SettingsStorage = {
  async read(): Promise<PersistedSettings> {
    try {
      const raw = await AsyncStorage.getItem(SETTINGS_KEY);
      if (!raw) return DEFAULT_SETTINGS;
      return normalizeSettings(JSON.parse(raw));
    } catch {
      return DEFAULT_SETTINGS;
    }
  },

  async write(patch: Partial<PersistedSettings>): Promise<void> {
    pendingSettingsWrite = pendingSettingsWrite
      .then(async () => {
        const current = await SettingsStorage.read();
        await AsyncStorage.setItem(
          SETTINGS_KEY,
          JSON.stringify({ ...current, ...patch }),
        );
      })
      .catch(() => {});

    await pendingSettingsWrite;
  },

  async reset(): Promise<void> {
    pendingSettingsWrite = pendingSettingsWrite
      .then(() => AsyncStorage.removeItem(SETTINGS_KEY))
      .catch(() => {});

    await pendingSettingsWrite;
  },
};

interface PersistedOnboarding {
  completed: boolean;
  // The step index the user last reached. Persisted on every advance so that
  // leaving the app mid-onboarding resumes where they left off instead of
  // restarting the flow. Ignored once `completed` is true.
  step: number;
}

const DEFAULT_ONBOARDING: PersistedOnboarding = { completed: false, step: 0 };

function clampStep(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

let pendingOnboardingWrite = Promise.resolve();

export const OnboardingStorage = {
  async read(): Promise<PersistedOnboarding> {
    try {
      const raw = await AsyncStorage.getItem(ONBOARDING_KEY);
      if (!raw) return DEFAULT_ONBOARDING;
      const parsed = JSON.parse(raw);
      if (!isRecord(parsed)) return DEFAULT_ONBOARDING;
      return {
        completed: parsed.completed === true,
        step: clampStep(parsed.step),
      };
    } catch {
      return DEFAULT_ONBOARDING;
    }
  },

  async write(patch: Partial<PersistedOnboarding>): Promise<void> {
    pendingOnboardingWrite = pendingOnboardingWrite
      .then(async () => {
        const current = await OnboardingStorage.read();
        await AsyncStorage.setItem(
          ONBOARDING_KEY,
          JSON.stringify({ ...current, ...patch }),
        );
      })
      .catch(() => {});

    await pendingOnboardingWrite;
  },

  async reset(): Promise<void> {
    pendingOnboardingWrite = pendingOnboardingWrite
      .then(() => AsyncStorage.removeItem(ONBOARDING_KEY))
      .catch(() => {});

    await pendingOnboardingWrite;
  },
};

// Age gate (device-level, pre-account). Stored under its own key and
// DELIBERATELY excluded from wipeLocalAppData below: deleting the account must
// NOT reset the gate, otherwise an under-16 user could bypass the block by
// deleting their account and re-creating one. This survives sign-out and full
// account deletion; only a fresh reinstall clears it. There is intentionally no
// path that ties this record to a uid.
//
// MIN_AGE and the age math live in @/domain/age (pure + unit-tested); re-exported
// here for the call sites that already import age-gate bits from storage.
export { MIN_AGE } from "@/domain/age";

export type AgeGateStatus = "unset" | "passed" | "blocked";

export interface PersistedAgeGate {
  status: AgeGateStatus;
  // ISO yyyy-mm-dd of the entered date of birth (kept for auditability / a
  // future server-side lie-and-lose check). Null until the gate is answered.
  birthDate: string | null;
}

const AGE_GATE_KEY = "app.ageGate";

const DEFAULT_AGE_GATE: PersistedAgeGate = { status: "unset", birthDate: null };

const AGE_GATE_STATUSES = new Set<AgeGateStatus>(["unset", "passed", "blocked"]);

function normalizeAgeGate(value: unknown): PersistedAgeGate {
  if (!isRecord(value)) return DEFAULT_AGE_GATE;
  const status =
    typeof value.status === "string" &&
    AGE_GATE_STATUSES.has(value.status as AgeGateStatus)
      ? (value.status as AgeGateStatus)
      : "unset";
  return {
    status,
    birthDate: typeof value.birthDate === "string" ? value.birthDate : null,
  };
}

let pendingAgeGateWrite = Promise.resolve();

export const AgeGateStorage = {
  async read(): Promise<PersistedAgeGate> {
    try {
      const raw = await AsyncStorage.getItem(AGE_GATE_KEY);
      if (!raw) return DEFAULT_AGE_GATE;
      return normalizeAgeGate(JSON.parse(raw));
    } catch {
      return DEFAULT_AGE_GATE;
    }
  },

  async write(patch: Partial<PersistedAgeGate>): Promise<void> {
    pendingAgeGateWrite = pendingAgeGateWrite
      .then(async () => {
        const current = await AgeGateStorage.read();
        await AsyncStorage.setItem(
          AGE_GATE_KEY,
          JSON.stringify({ ...current, ...patch }),
        );
      })
      .catch(() => {});

    await pendingAgeGateWrite;
  },
};

// Sticky chat preferences/session. We remember the conversation the user had
// open and the brainrot dial they last picked, so reopening the app drops them
// back where they were instead of a blank chat. Server-side data (the messages
// themselves) still lives in Firestore — this only persists which session to
// re-open and the local rot-level preference.
export interface PersistedChatSession {
  conversationId: string | null;
  rotLevel: number;
}

const CHAT_SESSION_KEY = "app.chatSession";

export const MIN_ROT_LEVEL = 1;
export const MAX_ROT_LEVEL = 3;
export const DEFAULT_ROT_LEVEL = 2;

export const DEFAULT_CHAT_SESSION: PersistedChatSession = {
  conversationId: null,
  rotLevel: DEFAULT_ROT_LEVEL,
};

function clampRotLevel(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_ROT_LEVEL;
  }
  return Math.min(Math.max(Math.round(value), MIN_ROT_LEVEL), MAX_ROT_LEVEL);
}

function normalizeChatSession(value: unknown): PersistedChatSession {
  if (!isRecord(value)) return DEFAULT_CHAT_SESSION;

  return {
    conversationId:
      typeof value.conversationId === "string" && value.conversationId.length > 0
        ? value.conversationId
        : null,
    rotLevel: clampRotLevel(value.rotLevel),
  };
}

let pendingChatSessionWrite = Promise.resolve();

export const ChatSessionStorage = {
  async read(): Promise<PersistedChatSession> {
    try {
      const raw = await AsyncStorage.getItem(CHAT_SESSION_KEY);
      if (!raw) return DEFAULT_CHAT_SESSION;
      return normalizeChatSession(JSON.parse(raw));
    } catch {
      return DEFAULT_CHAT_SESSION;
    }
  },

  async write(patch: Partial<PersistedChatSession>): Promise<void> {
    pendingChatSessionWrite = pendingChatSessionWrite
      .then(async () => {
        const current = await ChatSessionStorage.read();
        await AsyncStorage.setItem(
          CHAT_SESSION_KEY,
          JSON.stringify({ ...current, ...patch }),
        );
      })
      .catch(() => {});

    await pendingChatSessionWrite;
  },

  async reset(): Promise<void> {
    pendingChatSessionWrite = pendingChatSessionWrite
      .then(() => AsyncStorage.removeItem(CHAT_SESSION_KEY))
      .catch(() => {});

    await pendingChatSessionWrite;
  },
};

// One call clears every AsyncStorage key the template controls. Wired into
// the Settings "Delete data" action AFTER the account deletion callable
// succeeds, so a partial failure on the backend doesn't strand the user
// in a half-wiped local state.
//
// NOTE: AgeGateStorage is intentionally NOT reset here. The age gate is a
// device-level decision that must outlive account deletion — wiping it would let
// an under-16 user delete their account and re-pass the gate. It is only ever
// cleared by a full app reinstall.
export async function wipeLocalAppData(): Promise<void> {
  await Promise.all([
    SettingsStorage.reset(),
    OnboardingStorage.reset(),
    ChatSessionStorage.reset(),
  ]);
}
