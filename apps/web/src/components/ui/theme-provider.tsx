"use client";

/**
 * ThemeProvider — client-side theme selection context.
 *
 * Wraps the `useTheme()` hook which lets any client component:
 *   - Read the current theme id
 *   - Switch to a different theme
 *   - List available themes
 *
 * Theme CSS is injected entirely on the client: setTheme still records
 * the choice in the selected_theme cookie (so ThemeStyleSync can resolve
 * it on any page), but the visible switch is instant — the theme's CSS is
 * computed here with themeToFullStyleString, cached in localStorage
 * ("ae-theme-css" / "ae-theme-css-for") for the layout bootstrap script,
 * and swapped into the <style data-theme-override> element immediately.
 * No server round-trip or router refresh is involved.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AppTheme } from "@/lib/themes";
import { THEME_COOKIE, themeToFullStyleString } from "@/lib/theme-engine";
import {
  clearThemeCss,
  storeAndApplyThemeCss,
} from "@/components/ui/theme-style-sync";

/* ------------------------------------------------------------------ */
/* Context shape                                                        */
/* ------------------------------------------------------------------ */

interface ThemeContextValue {
  /** Currently selected theme id (null = using globals.css defaults). */
  themeId: string | null;
  /** Switch to a theme by id. Pass null to clear the custom theme. */
  setTheme: (id: string | null) => void;
  /** All available themes from the API catalog. */
  themes: AppTheme[];
  /** True while the catalog is being fetched. */
  isLoading: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  themeId: null,
  setTheme: () => {},
  themes: [],
  isLoading: false,
});

/* ------------------------------------------------------------------ */
/* Provider                                                             */
/* ------------------------------------------------------------------ */

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themes, setThemes] = useState<AppTheme[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [themeId, setThemeIdState] = useState<string | null>(null);

  // Read initial theme from cookie on mount.
  useEffect(() => {
    const match = document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${THEME_COOKIE}=`));
    if (match) {
      setThemeIdState(match.slice(THEME_COOKIE.length + 1) || null);
    }
  }, []);

  // Fetch public theme catalog.
  useEffect(() => {
    setIsLoading(true);
    fetch("/api/v1/themes")
      .then((r) => r.json())
      .then((json: { data?: AppTheme[] }) => {
        setThemes(json.data ?? []);
      })
      .catch(() => {
        // Silently ignore — themes just won't list.
      })
      .finally(() => setIsLoading(false));
  }, []);

  const setTheme = useCallback(
    (id: string | null) => {
      if (id === null) {
        // Clear cookie + cached CSS + injected style element.
        document.cookie = `${THEME_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
        setThemeIdState(null);
        clearThemeCss();
      } else {
        document.cookie = `${THEME_COOKIE}=${id}; path=/; max-age=31536000; SameSite=Lax`;
        setThemeIdState(id);
        // Apply instantly from the already-fetched catalog. If the
        // catalog hasn't loaded yet, ThemeStyleSync resolves the
        // cookie on the next page load instead.
        const theme = themes.find((t) => t.id === id);
        if (theme) {
          storeAndApplyThemeCss(id, themeToFullStyleString(theme));
        }
      }
    },
    [themes],
  );

  return (
    <ThemeContext.Provider value={{ themeId, setTheme, themes, isLoading }}>
      {children}
    </ThemeContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* Hook                                                                 */
/* ------------------------------------------------------------------ */

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
