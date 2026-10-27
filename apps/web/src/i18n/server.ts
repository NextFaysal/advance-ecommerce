/**
 * Unified language system (doc 30) — SERVER side.
 *
 * getStoreDefaultLocale(): the owner-set default from the `general.locale`
 * setting (DB → env DEFAULT_LOCALE → built-in default "bn", all inside
 * getSetting's own resolution chain), validated as a Locale.
 *
 * getRequestLocale(): the locale THIS request should render in —
 * the visitor's `ae-locale` cookie override when valid, else the store
 * default. Reading cookies() makes the calling route dynamic; surfaces
 * that must stay static should take the store default only and let the
 * client LocaleProvider adopt the override after mount (the root layout
 * does exactly that).
 */
import { cookies } from "next/headers";
import { getSetting } from "@/lib/settings";
import { FALLBACK_LOCALE, LOCALE_COOKIE, normalizeLocale, type Locale } from "./locale";

export async function getStoreDefaultLocale(): Promise<Locale> {
  try {
    const value = await getSetting("general.locale");
    return normalizeLocale(value) ?? FALLBACK_LOCALE;
  } catch {
    // DB unreachable — the built-in default keeps the storefront rendering.
    return FALLBACK_LOCALE;
  }
}

export async function getRequestLocale(): Promise<Locale> {
  try {
    const jar = await cookies();
    const override = normalizeLocale(jar.get(LOCALE_COOKIE)?.value);
    if (override !== null) return override;
  } catch {
    // Outside a request scope (or cookies unavailable) — store default.
  }
  return getStoreDefaultLocale();
}
