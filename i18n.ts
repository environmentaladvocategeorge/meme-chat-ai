import * as Localization from "expo-localization";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import es from "./locales/es";

export const SUPPORTED_LANGUAGES = ["en", "es"] as const;
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
  },
  lng: resolveLanguage("system"),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18next;
