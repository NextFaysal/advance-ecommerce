"use client";

/**
 * ThemeView context — doc 25 §1.4 ("a ThemeView context for leaves").
 *
 * Carries the PLAIN SERIALISABLE ThemeView (packageId, instanceId,
 * lockPalette, supportsDark, options) from the composition roots to
 * leaf components. The value contains NO functions and NO component
 * references — it is data that crossed the RSC boundary as props,
 * per the platform rule from the 2026-10-25 incident.
 *
 * S0 scope: the module ships UNMOUNTED. S3's storefront shell wrapper
 * (server) resolves the store theme and renders <ThemeViewProvider>
 * around the shell; until then every useThemeView() call returns the
 * safe Aurora default below, so adopting the hook early is harmless.
 */
import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_THEME_VIEW, type ThemeView } from "./resolution";

const ThemeViewContext = createContext<ThemeView>(DEFAULT_THEME_VIEW);

export function ThemeViewProvider({
  view,
  children,
}: {
  view: ThemeView;
  children: ReactNode;
}) {
  return <ThemeViewContext.Provider value={view}>{children}</ThemeViewContext.Provider>;
}

/**
 * The current theme view. Outside a provider (admin pages, tests,
 * pre-S3 storefront) this returns DEFAULT_THEME_VIEW — Aurora, no
 * instance — which is also the correct value whenever no store theme
 * is set.
 */
export function useThemeView(): ThemeView {
  return useContext(ThemeViewContext);
}
