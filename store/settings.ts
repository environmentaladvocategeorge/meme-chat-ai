import i18next, { resolveLanguage } from "@/i18n";
import { create } from "zustand";
import {
  Appearance,
  DEFAULT_SETTINGS,
  Language,
  SettingsStorage,
} from "./storage";

export type { Appearance, Language } from "./storage";

interface SettingsState {
  appearance: Appearance;
  language: Language;
  hydrate: () => Promise<void>;
  setAppearance: (v: Appearance) => void;
  setLanguage: (v: Language) => void;
  reset: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  ...DEFAULT_SETTINGS,

  hydrate: async () => {
    const stored = await SettingsStorage.read();
    set({
      appearance: stored.appearance,
      language: stored.language,
    });
    i18next.changeLanguage(resolveLanguage(stored.language));
  },

  setAppearance: (appearance) => {
    if (get().appearance === appearance) return;
    set({ appearance });
    SettingsStorage.write({ appearance });
  },

  setLanguage: (language) => {
    if (get().language === language) return;
    set({ language });
    SettingsStorage.write({ language });
    i18next.changeLanguage(resolveLanguage(language));
  },

  reset: async () => {
    await SettingsStorage.reset();
    set(DEFAULT_SETTINGS);
    i18next.changeLanguage(resolveLanguage(DEFAULT_SETTINGS.language));
  },
}));
