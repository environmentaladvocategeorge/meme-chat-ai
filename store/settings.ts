import i18next, { resolveLanguage } from "@/i18n";
import {
  addThemePreset,
  type ChatThemePreset,
  type ChatUiColorOverrides,
  type ChatUiColorRole,
  deleteThemePreset,
  normalizeHex,
} from "@/domain/customization";
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
  chatUiColors: ChatUiColorOverrides;
  chatThemePresets: ChatThemePreset[];
  alias: string;
  hydrate: () => Promise<void>;
  setAppearance: (v: Appearance) => void;
  setLanguage: (v: Language) => void;
  setChatBubbleStyle: (v: string) => void;
  setChatBackground: (v: string) => void;
  setChatUiColors: (v: ChatUiColorOverrides) => void;
  setChatUiColor: (role: ChatUiColorRole, color: string | null) => void;
  applyChatThemePreset: (preset: ChatThemePreset) => void;
  addChatThemePreset: (preset: ChatThemePreset) => void;
  deleteChatThemePreset: (key: string) => void;
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
      chatUiColors: stored.chatUiColors,
      chatThemePresets: stored.chatThemePresets,
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

  setChatUiColors: (chatUiColors) => {
    set({ chatUiColors });
    SettingsStorage.write({ chatUiColors });
  },

  setChatUiColor: (role, color) => {
    const chatUiColors = { ...get().chatUiColors };
    const normalized = color ? normalizeHex(color) : null;
    if (normalized) chatUiColors[role] = normalized;
    else delete chatUiColors[role];
    set({ chatUiColors });
    SettingsStorage.write({ chatUiColors });
  },

  // Applying a preset swaps the whole look in one write. uiColors is REPLACED
  // (not merged) so a theme that doesn't set, say, userText doesn't inherit a
  // stale value from the previous theme. Saved presets are untouched.
  applyChatThemePreset: ({ bubbleStyle, background, uiColors }) => {
    const chatUiColors = { ...uiColors };
    set({
      chatBubbleStyle: bubbleStyle,
      chatBackground: background,
      chatUiColors,
    });
    SettingsStorage.write({
      chatBubbleStyle: bubbleStyle,
      chatBackground: background,
      chatUiColors,
    });
  },

  addChatThemePreset: (preset) => {
    const chatThemePresets = addThemePreset(preset, get().chatThemePresets);
    set({ chatThemePresets });
    SettingsStorage.write({ chatThemePresets });
  },

  deleteChatThemePreset: (key) => {
    const chatThemePresets = deleteThemePreset(key, get().chatThemePresets);
    set({ chatThemePresets });
    SettingsStorage.write({ chatThemePresets });
  },

  // Reverts the live look to system defaults. Deliberately leaves the user's
  // saved presets in place — "reset" is about the current chat, not a wipe.
  resetChatAppearance: () => {
    const { chatBubbleStyle, chatBackground, chatUiColors } = DEFAULT_SETTINGS;
    set({ chatBubbleStyle, chatBackground, chatUiColors });
    SettingsStorage.write({ chatBubbleStyle, chatBackground, chatUiColors });
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
