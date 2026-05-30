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
  chatBubbleStyle: string;
  chatBackground: string;
  alias: string;
  hydrate: () => Promise<void>;
  setAppearance: (v: Appearance) => void;
  setLanguage: (v: Language) => void;
  setChatBubbleStyle: (v: string) => void;
  setChatBackground: (v: string) => void;
  resetChatAppearance: () => void;
  setAlias: (v: string) => void;
  reset: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  ...DEFAULT_SETTINGS,

  hydrate: async () => {
    const stored = await SettingsStorage.read();
    set({
      appearance: stored.appearance,
      language: stored.language,
      chatBubbleStyle: stored.chatBubbleStyle,
      chatBackground: stored.chatBackground,
      alias: stored.alias,
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

  setChatBubbleStyle: (chatBubbleStyle) => {
    if (get().chatBubbleStyle === chatBubbleStyle) return;
    set({ chatBubbleStyle });
    SettingsStorage.write({ chatBubbleStyle });
  },

  setChatBackground: (chatBackground) => {
    if (get().chatBackground === chatBackground) return;
    set({ chatBackground });
    SettingsStorage.write({ chatBackground });
  },

  resetChatAppearance: () => {
    const { chatBubbleStyle, chatBackground } = DEFAULT_SETTINGS;
    set({ chatBubbleStyle, chatBackground });
    SettingsStorage.write({ chatBubbleStyle, chatBackground });
  },

  setAlias: (alias) => {
    if (get().alias === alias) return;
    set({ alias });
    SettingsStorage.write({ alias });
  },

  reset: async () => {
    await SettingsStorage.reset();
    set(DEFAULT_SETTINGS);
    i18next.changeLanguage(resolveLanguage(DEFAULT_SETTINGS.language));
  },
}));
