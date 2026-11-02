import { LOCALES, type Locale } from "@farmhand/contracts";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enUS from "./en-US.json";
import ptBR from "./pt-BR.json";

const STORAGE_KEY = "farmhand.locale";

const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);

function initialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (isLocale(stored)) return stored;
  return navigator.language.toLowerCase().startsWith("pt") ? "pt-BR" : "en-US";
}

export function setLocale(locale: Locale) {
  localStorage.setItem(STORAGE_KEY, locale);
  void i18n.changeLanguage(locale);
}

i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
});

void i18n.use(initReactI18next).init({
  resources: { "en-US": { translation: enUS }, "pt-BR": { translation: ptBR } },
  lng: initialLocale(),
  fallbackLng: "en-US",
  interpolation: { escapeValue: false },
});

export default i18n;
