/**
 * Theme engine — pure helpers (no DB, no cookies) to convert an AppTheme
 * into CSS output or inline style strings.
 *
 * Design:
 *   - Dark tokens are stored as overrides only (delta from light).
 *   - When rendering for dark mode we merge: { ...light, ...dark }.
 *   - The injected <style> tag goes AFTER globals.css so it can override
 *     individual tokens without needing !important.
 */
import type { AppTheme } from "./themes";

/** Cookie name holding the selected theme id. */
export const THEME_COOKIE = "selected_theme";

/** Setting key under which the theme catalog JSON is stored. */
export const THEME_CATALOG_SETTING_KEY = "theme.catalog";

/**
 * Resolve the final token map for a given mode.
 * Dark mode = light tokens merged with dark overrides.
 */
function resolveTokens(
  theme: AppTheme,
  mode: "light" | "dark",
): Record<string, string> {
  if (mode === "light") return theme.tokens.light;
  return { ...theme.tokens.light, ...theme.tokens.dark };
}

/**
 * Build a full CSS `:root { ... }` block for the theme.
 * For dark mode this is injected as `.dark { ... }` inside a style tag.
 */
export function themeToStyleString(theme: AppTheme, mode: "light" | "dark"): string {
  const tokens = resolveTokens(theme, mode);
  const vars = Object.entries(tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");

  if (mode === "light") {
    return `:root {\n${vars}\n}`;
  }
  // dark mode — selector matches what ThemeToggle adds to <html>
  return `.dark {\n${vars}\n}`;
}

/**
 * Build a combined <style> block for both light and dark modes.
 * Suitable for injection into <head> as a single <style> tag.
 */
export function themeToFullStyleString(theme: AppTheme): string {
  const lightBlock = themeToStyleString(theme, "light");
  const darkBlock = themeToStyleString(theme, "dark");
  return `/* Theme: ${theme.name} (${theme.id}) */\n${lightBlock}\n${darkBlock}`;
}

/**
 * Build an inline style attribute value (for element-level theming).
 * Applies for the given mode.
 */
export function themeToStyleAttr(theme: AppTheme, mode: "light" | "dark"): string {
  const tokens = resolveTokens(theme, mode);
  return Object.entries(tokens)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
}
