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
 *   2. This component runs on mount: if the selected_theme cookie and
 *      the cached CSS disagree (first visit, theme changed elsewhere,
 *      catalog edited), it fetches /api/v1/themes, recomputes the CSS
 *      with themeToFullStyleString, refreshes the localStorage cache
 *      ("ae-theme-css" + "ae-theme-css-for" = the theme id it belongs
 *      to) and swaps the injected <style> element.
 *   3. ThemeProvider.setTheme uses the same helpers so a switch applies
 *      instantly without a server round-trip.
 *
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
    try {
      const themeId = readSelectedThemeId();
      if (!themeId) {
        // No theme selected — clear any stale cache/injected style left
        // behind by a previous selection (e.g. cookie expired/cleared
        // outside ThemeProvider).
        clearThemeCss();
        return;
      }

      let cachedCss: string | null = null;
      let cachedFor: string | null = null;
      try {
        cachedCss = localStorage.getItem(THEME_CSS_STORAGE_KEY);
        cachedFor = localStorage.getItem(THEME_CSS_FOR_STORAGE_KEY);
      } catch {
        // Storage blocked — fall through to the fetch below.
      }
      if (cachedCss && cachedFor === themeId) {
        // Bootstrap already applied exactly this CSS before first paint.
        return;
      }

      fetch("/api/v1/themes")
        .then((r) => r.json())
        .then((json: { data?: AppTheme[] }) => {
          if (cancelled) return;
          const theme = (json.data ?? []).find((t) => t.id === themeId);
          if (!theme) return; // Unknown id — leave bootstrap CSS as-is.
          storeAndApplyThemeCss(themeId, themeToFullStyleString(theme));
        })
        .catch(() => {
          // Fetch failed — leave whatever the bootstrap applied.
        });
    } catch {
      // Defensive: theme sync must never break the page.
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
