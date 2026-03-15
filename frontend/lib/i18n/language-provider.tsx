"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { t as translate, LS_LANGUAGE_KEY, LANGUAGES, type Language } from "@/lib/i18n";
import type { DictionaryKeys } from "@/lib/i18n";

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: DictionaryKeys) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function getInitialLanguage(): Language {
  if (typeof window === "undefined") return "ru";
  const stored = localStorage.getItem(LS_LANGUAGE_KEY);
  if (stored && (LANGUAGES as readonly string[]).includes(stored)) return stored as Language;
  return "ru";
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("ru");

  // Hydrate from localStorage on mount
  useEffect(() => {
    setLanguageState(getInitialLanguage());
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(LS_LANGUAGE_KEY, lang);
    } catch {
      /* quota / SSR */
    }
  }, []);

  const t = useCallback(
    (key: DictionaryKeys) => translate(key, language),
    [language],
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage() must be used inside <LanguageProvider>");
  return ctx;
}
