"use client";

/**
 * Unified language system (doc 30) — client context.
 *
 * Mounted once in the root layout with the SERVER-resolved locale
 * (visitor cookie override → store default). On mount it re-reads the
 * stored choice (localStorage may hold a choice the cookie lost) and
 * adopts it; it then listens for the same-tab change event and the
 * cross-tab `storage` event so every mounted surface switches together —
 * that "everything switches at once" behaviour is the whole point.
 *
 * `setLocale` persists the choice (cookie + localStorage via
 * setStoredLocale) and updates state; components re-render in the new
 * language without a reload.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  LOCALE_CHANGE_EVENT,
  LOCALE_STORAGE_KEY,
  getStoredLocale,
  normalizeLocale,
  pick,
  setStoredLocale,
  type Locale,
} from "./locale";
import { COMMON_STRINGS, type CommonStrings } from "./dictionaries";

interface LocaleContextValue {
  locale: Locale;
  isBn: boolean;
  setLocale: (locale: Locale) => void;
  /** The shared dictionary (src/i18n/dictionaries.ts) for the active locale. */
  t: CommonStrings;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  defaultLocale,
  children,
}: {
  /** Server-resolved locale (cookie override → store default). */
  defaultLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);

  useEffect(() => {
    const stored = getStoredLocale();
    if (stored !== null && stored !== defaultLocale) setLocaleState(stored);
    // Only the mount-time adoption depends on the server value; later
    // changes flow through setLocale / the listeners below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onChange = () => {
      const next = getStoredLocale();
      if (next !== null) setLocaleState(next);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === LOCALE_STORAGE_KEY) {
        const next = normalizeLocale(event.newValue);
        if (next !== null) setLocaleState(next);
      }
    };
    window.addEventListener(LOCALE_CHANGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(LOCALE_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setStoredLocale(next);
    setLocaleState(next);
  }, []);

  return (
    <LocaleContext.Provider
      value={{ locale, isBn: locale === "bn", setLocale, t: pick(locale, COMMON_STRINGS) }}
    >
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (ctx === null) {
    throw new Error("useLocale must be used inside <LocaleProvider> (mounted in the root layout)");
  }
  return ctx;
}
