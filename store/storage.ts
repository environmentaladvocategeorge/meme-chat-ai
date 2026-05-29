import AsyncStorage from "@react-native-async-storage/async-storage";

export type Appearance = "system" | "light" | "dark";
export type Language = "system" | "en" | "es";

export interface PersistedSettings {
  appearance: Appearance;
  language: Language;
}

const SETTINGS_KEY = "app.settings";
const ONBOARDING_KEY = "app.onboarding";

const APPEARANCE_VALUES = new Set<Appearance>(["system", "light", "dark"]);
const LANGUAGE_VALUES = new Set<Language>(["system", "en", "es"]);

export const DEFAULT_SETTINGS: PersistedSettings = {
  appearance: "system",
  language: "system",
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
}

const DEFAULT_ONBOARDING: PersistedOnboarding = { completed: false };

let pendingOnboardingWrite = Promise.resolve();

export const OnboardingStorage = {
  async read(): Promise<PersistedOnboarding> {
    try {
      const raw = await AsyncStorage.getItem(ONBOARDING_KEY);
      if (!raw) return DEFAULT_ONBOARDING;
      const parsed = JSON.parse(raw);
      if (!isRecord(parsed)) return DEFAULT_ONBOARDING;
      return { completed: parsed.completed === true };
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
export async function wipeLocalAppData(): Promise<void> {
  await Promise.all([
    SettingsStorage.reset(),
    OnboardingStorage.reset(),
    ChatSessionStorage.reset(),
  ]);
}
