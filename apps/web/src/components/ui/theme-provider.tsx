"use client";

/**
 * ThemeProvider — client-side theme selection context.
 *
 * Wraps the `useTheme()` hook which lets any client component:
 *   - Read the current theme id
 *   - Switch to a different theme (sets cookie + reloads for SSR injection)
 *   - List available themes
 *
 * The actual CSS injection happens server-side in layout.tsx via the
 * selected_theme cookie. Switching a theme sets the cookie and triggers
 * a router refresh so the server re-renders with the new theme style block.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { AppTheme } from "@/lib/themes";
import { THEME_COOKIE } from "@/lib/theme-engine";

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
  const router = useRouter();
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
        // Clear cookie
        document.cookie = `${THEME_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
        setThemeIdState(null);
      } else {
        document.cookie = `${THEME_COOKIE}=${id}; path=/; max-age=31536000; SameSite=Lax`;
        setThemeIdState(id);
      }
      // Refresh so layout.tsx re-runs and injects the new theme style block.
      router.refresh();
    },
    [router],
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
