"use client";

/**
 * ThemeStyleSync — client-side application of the selected theme.
 *
 * The root layout used to resolve the selected_theme cookie on the server
 * and inject a <style data-theme-override> block. That cookies() call made
 * every page dynamic, blocking static rendering / ISR, so theme
 * application now happens entirely on the client:
 *
 *   1. A bootstrap <script> in layout.tsx reads localStorage
 *      "ae-theme-css" before first paint and injects the cached CSS
 *      (same no-flash pattern as the dark-mode bootstrap).
 *   2. This component runs on mount and resolves the override in
 *      priority order:
 *        a. the visitor's own pick (selected_theme cookie), then
 *        b. the STORE DEFAULT theme (Admin → Appearance → "স্টোরে
 *           প্রয়োগ করুন"; served under meta.storeDefaultTheme by
 *           /api/v1/themes), then
 *        c. no override — globals.css defaults.
 *      Whichever wins, its CSS is computed with
 *      themeToFullStyleString, cached in localStorage ("ae-theme-css"
 *      + "ae-theme-css-for" = the theme id it belongs to) and swapped
 *      into the injected <style> element.
 *   3. ThemeProvider.setTheme uses the same helpers so a switch applies
 *      instantly without a server round-trip; clearing a personal pick
 *      falls back to the store default via applyStoreDefaultThemeCss.
 *
 * The root layout stays cookie-free: the store default reaches the
 * client purely as data from /api/v1/themes, never via request cookies.
 * If the fetch fails, whatever the bootstrap applied stays in place.
 */
import { useEffect } from "react";
import { THEME_COOKIE, themeToFullStyleString } from "@/lib/theme-engine";
import type { AppTheme } from "@/lib/themes";

/** localStorage key holding the last computed theme CSS. */
export const THEME_CSS_STORAGE_KEY = "ae-theme-css";
/** localStorage key holding the theme id THEME_CSS_STORAGE_KEY belongs to. */
export const THEME_CSS_FOR_STORAGE_KEY = "ae-theme-css-for";

const STYLE_SELECTOR = 'style[data-theme-override="true"]';

/** Insert or replace the theme override <style> element in <head>. */
export function applyThemeStyleElement(css: string): void {
  const existing = document.head.querySelector(STYLE_SELECTOR);
  if (existing) {
    existing.textContent = css;
    return;
  }
  const el = document.createElement("style");
  el.setAttribute("data-theme-override", "true");
  el.textContent = css;
  document.head.appendChild(el);
}

/** Remove the theme override <style> element from <head>, if present. */
export function removeThemeStyleElement(): void {
  document.head.querySelector(STYLE_SELECTOR)?.remove();
}

/** Cache a theme's computed CSS in localStorage and apply it immediately. */
export function storeAndApplyThemeCss(themeId: string, css: string): void {
  try {
    localStorage.setItem(THEME_CSS_STORAGE_KEY, css);
    localStorage.setItem(THEME_CSS_FOR_STORAGE_KEY, themeId);
  } catch {
    // Storage full/blocked — the style element below still applies it
    // for this page view; the next load just re-resolves via fetch.
  }
  applyThemeStyleElement(css);
}

/** Drop the cached theme CSS and the injected <style> element. */
export function clearThemeCss(): void {
  try {
    localStorage.removeItem(THEME_CSS_STORAGE_KEY);
    localStorage.removeItem(THEME_CSS_FOR_STORAGE_KEY);
  } catch {
    // Ignore — removing the style element below is the visible part.
  }
  removeThemeStyleElement();
}

/** Read one localStorage value defensively (null when unavailable). */
function readCache(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

interface ThemesApiPayload {
  data?: AppTheme[];
  meta?: {
    storeDefaultThemeId?: string | null;
    storeDefaultTheme?: AppTheme | null;
  };
}

/**
 * Fallback step (b): fetch the catalog and apply the store default
 * theme, if the merchant set one. Returns true when a store default
 * was applied (or was already the cached CSS), false when there is
 * none — the caller then decides whether to clear stale CSS.
 */
export async function applyStoreDefaultThemeCss(): Promise<boolean> {
  try {
    const res = await fetch("/api/v1/themes");
    const json = (await res.json()) as ThemesApiPayload;
    const theme =
      json.meta?.storeDefaultTheme ??
      (json.data ?? []).find((t) => t.isStoreDefault) ??
      null;
    if (!theme) return false;
    if (readCache(THEME_CSS_FOR_STORAGE_KEY) === theme.id && readCache(THEME_CSS_STORAGE_KEY)) {
      // Bootstrap already applied exactly this CSS before first paint.
      return true;
    }
    storeAndApplyThemeCss(theme.id, themeToFullStyleString(theme));
    return true;
  } catch {
    return false;
  }
}

/** Read the selected_theme cookie value (null when unset/empty). */
function readSelectedThemeId(): string | null {
  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${THEME_COOKIE}=`));
  if (!match) return null;
  return match.slice(THEME_COOKIE.length + 1) || null;
}

export default function ThemeStyleSync() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const themeId = readSelectedThemeId();
        if (!themeId) {
          // No personal pick — the store default (if any) wins; with
          // no store default either, clear any stale cache/injected
          // style left behind by a previous selection (e.g. cookie
          // expired/cleared outside ThemeProvider).
          const applied = await applyStoreDefaultThemeCss();
          if (!applied && !cancelled) clearThemeCss();
          return;
        }

        const cachedCss = readCache(THEME_CSS_STORAGE_KEY);
        const cachedFor = readCache(THEME_CSS_FOR_STORAGE_KEY);
        if (cachedCss && cachedFor === themeId) {
          // Bootstrap already applied exactly this CSS before first paint.
          return;
        }

        const res = await fetch("/api/v1/themes");
        const json = (await res.json()) as ThemesApiPayload;
        if (cancelled) return;
        const storeDefault = json.meta?.storeDefaultTheme ?? null;
        const theme =
          (json.data ?? []).find((t) => t.id === themeId) ??
          (storeDefault && storeDefault.id === themeId ? storeDefault : undefined);
        if (!theme) return; // Unknown id — leave bootstrap CSS as-is.
        storeAndApplyThemeCss(themeId, themeToFullStyleString(theme));
      } catch {
        // Defensive: theme sync must never break the page; whatever
        // the bootstrap applied stays in place.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
