"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { LanguageCode, LanguageMeta, Strings } from "./types";
import { en } from "./en";
import { hi } from "./hi";
import { mr } from "./mr";
import { bn } from "./bn";
import { gu } from "./gu";
import { pa } from "./pa";
import { ta } from "./ta";
import { te } from "./te";
import { kn } from "./kn";
import { ml } from "./ml";
import { or as orLang } from "./or";
import { as as asLang } from "./as";

export const LANGUAGES: LanguageMeta[] = [
  { code: "en", label: "English", short: "EN" },
  { code: "hi", label: "हिन्दी", short: "HI" },
  { code: "mr", label: "मराठी", short: "MR" },
  { code: "bn", label: "বাংলা", short: "BN" },
  { code: "gu", label: "ગુજરાતી", short: "GU" },
  { code: "pa", label: "ਪੰਜਾਬੀ", short: "PA" },
  { code: "ta", label: "தமிழ்", short: "TA" },
  { code: "te", label: "తెలుగు", short: "TE" },
  { code: "kn", label: "ಕನ್ನಡ", short: "KN" },
  { code: "ml", label: "മലയാളം", short: "ML" },
  { code: "or", label: "ଓଡ଼ିଆ", short: "OR" },
  { code: "as", label: "অসমীয়া", short: "AS" },
];

const STORAGE_KEY = "snapsave_language";
const DEFAULT_LANG: LanguageCode = "en";

const catalogs: Record<LanguageCode, Strings> = {
  en, hi, mr, bn, gu, pa, ta, te, kn, ml, or: orLang, as: asLang,
};

function isLangCode(value: unknown): value is LanguageCode {
  return (
    typeof value === "string" &&
    (LANGUAGES as LanguageMeta[]).some((l) => l.code === value)
  );
}

// Deep-merge the selected catalog over English so any missing key
// automatically falls back to the English string (arrays by index).
function withFallback(selected: Strings): Strings {
  const merge = (base: unknown, over: unknown): unknown => {
    if (Array.isArray(base)) {
      const o = Array.isArray(over) ? over : [];
      return base.map((b, i) => (i < o.length && o[i] !== undefined ? merge(b, o[i]) : b));
    }
    if (base !== null && typeof base === "object" && over !== null && typeof over === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(base as Record<string, unknown>)) {
        const b = (base as Record<string, unknown>)[key];
        const o = (over as Record<string, unknown>)[key];
        out[key] = o === undefined ? b : merge(b, o);
      }
      return out;
    }
    return over === undefined || over === "" ? base : over;
  };
  return merge(en, selected) as Strings;
}

interface LanguageContextValue {
  lang: LanguageCode;
  setLang: (code: LanguageCode) => void;
  t: Strings;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: en,
});

function readStoredLang(): LanguageCode {
  if (typeof window === "undefined") return DEFAULT_LANG;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLangCode(stored)) return stored;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_LANG;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LanguageCode>(DEFAULT_LANG);

  // Restore the saved language after mount (initial render stays English
  // so server and client HTML always match — no hydration mismatch).
  useEffect(() => {
    queueMicrotask(() => {
      const stored = readStoredLang();
      if (stored !== DEFAULT_LANG) setLangState(stored);
    });
  }, []);

  // Keep <html lang> in sync for accessibility and SEO.
  useEffect(() => {
    try {
      document.documentElement.setAttribute("lang", lang);
    } catch {
      /* non-DOM environment */
    }
  }, [lang ]);

  const setLang = useCallback((code: LanguageCode) => {
    if (!isLangCode(code)) return;
    setLangState(code);
    try {
      window.localStorage.setItem(STORAGE_KEY, code);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const t = useMemo(() => withFallback(catalogs[lang]), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
