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

// One call clears every AsyncStorage key the template controls. Wired into
// the Settings "Delete data" action AFTER the account deletion callable
// succeeds, so a partial failure on the backend doesn't strand the user
// in a half-wiped local state.
export async function wipeLocalAppData(): Promise<void> {
  await Promise.all([SettingsStorage.reset(), OnboardingStorage.reset()]);
}
