import * as Localization from "expo-localization";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import es from "./locales/es";
import fr from "./locales/fr";
import pt from "./locales/pt";
import de from "./locales/de";
import zh from "./locales/zh";
import ja from "./locales/ja";
import hi from "./locales/hi";
import ru from "./locales/ru";

export const SUPPORTED_LANGUAGES = ["en", "es", "fr", "pt", "de", "zh", "ja", "hi", "ru"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function resolveLanguage(lang: string): SupportedLanguage {
  const code =
    lang === "system"
      ? (Localization.getLocales()[0]?.languageCode ?? "en")
      : lang;
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code)
    ? (code as SupportedLanguage)
    : "en";
}

i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    fr: { translation: fr },
    pt: { translation: pt },
    de: { translation: de },
    zh: { translation: zh },
    ja: { translation: ja },
    hi: { translation: hi },
    ru: { translation: ru },
  },
  lng: resolveLanguage("system"),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18next;
