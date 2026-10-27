/**
 * Unified language system (doc 30) — PURE module, client-safe.
 *
 * The rule (Nazmul, 2026-10-27): English selected → EVERYTHING English;
 * Bangla selected → EVERYTHING Bangla. No mixed UI.
 *
 * Resolution order everywhere:
 *   1. The visitor's own choice (cookie `ae-locale` + localStorage) — wins.
 *   2. The store default (`general.locale` admin setting) — resolved server-side.
 *   3. Built-in fallback `bn`.
 *
 * Storage conventions mirror src/lib/numerals.ts: an "advance-ecommerce:"-
 * prefixed localStorage key plus a same-tab change event (the `storage`
 * event never fires in the tab that wrote). The cookie exists so the
 * SERVER renders the visitor's chosen language too — localStorage alone
 * would leave SSR in the store default and flash/mix on hydration.
 */

export type Locale = "bn" | "en";

export const LOCALES: readonly Locale[] = ["bn", "en"] as const;

export const FALLBACK_LOCALE: Locale = "bn";

export const LOCALE_COOKIE = "ae-locale";
export const LOCALE_STORAGE_KEY = "advance-ecommerce:locale";
export const LOCALE_CHANGE_EVENT = "advance-ecommerce:locale-changed";

export function isLocale(value: unknown): value is Locale {
  return value === "bn" || value === "en";
}

/** Validate an arbitrary value as a Locale; null when it is not one. */
export function normalizeLocale(value: unknown): Locale | null {
  return isLocale(value) ? value : null;
}

/** Pick the entry for `locale` out of a full {bn, en} dictionary. */
export function pick<T>(locale: Locale, dict: Record<Locale, T>): T {
  return dict[locale];
}

/** Replace `{name}`-style placeholders in a dictionary template string. */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

/** BCP-47 tag for Intl / toLocale* calls in the given locale. */
export function intlLocale(locale: Locale): string {
  return locale === "bn" ? "bn-BD" : "en-GB";
}

/** Human name of a locale, written in that locale itself. */
export const LOCALE_SELF_NAMES: Record<Locale, string> = {
  bn: "বাংলা",
  en: "English",
};

function readCookieLocale(): Locale | null {
  if (typeof document === "undefined") return null;
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
    return match ? normalizeLocale(decodeURIComponent(match[1] ?? "")) : null;
  } catch {
    return null;
  }
}

/**
 * The visitor's stored choice: localStorage first (written together with
 * the cookie by setStoredLocale, so they cannot disagree in practice),
 * then the cookie. Null when the visitor never chose — caller falls back
 * to the store default.
 */
export function getStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const fromStorage = normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
    if (fromStorage !== null) return fromStorage;
  } catch {
    // Storage unavailable (private mode etc.) — fall through to cookie.
  }
  return readCookieLocale();
}

/**
 * Persist the visitor's choice: localStorage + a 1-year cookie (so the
 * server renders it too) + `<html lang>` + the same-tab change event that
 * LocaleProvider listens to.
 */
export function setStoredLocale(locale: Locale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage unavailable — the cookie below still persists the choice.
  }
  try {
    const oneYear = 60 * 60 * 24 * 365;
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${oneYear}; samesite=lax`;
    document.documentElement.lang = locale;
  } catch {
    // Cookie/DOM unavailable — the change event still applies it this tab.
  }
  window.dispatchEvent(new Event(LOCALE_CHANGE_EVENT));
}
