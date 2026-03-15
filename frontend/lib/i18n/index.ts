export { default as ru } from "./dictionaries/ru";
export type { DictionaryKeys, Dictionary } from "./dictionaries/ru";
export { default as kk } from "./dictionaries/kk";

import ruDict from "./dictionaries/ru";
import kkDict from "./dictionaries/kk";
import type { DictionaryKeys, Dictionary } from "./dictionaries/ru";

export const LANGUAGES = ["ru", "kk"] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  ru: "RU",
  kk: "KZ",
};

const dictionaries: Record<Language, Partial<Dictionary>> = { ru: ruDict, kk: kkDict };

/**
 * Translate helper.  Falls back to Russian when a key is missing in the
 * selected language dictionary.
 */
export function t(key: DictionaryKeys, lang: Language = "ru"): string {
  return (dictionaries[lang] as Record<string, string | undefined>)[key] ?? ruDict[key] ?? key;
}

/** Storage key used by LanguageProvider */
export const LS_LANGUAGE_KEY = "app-language";
