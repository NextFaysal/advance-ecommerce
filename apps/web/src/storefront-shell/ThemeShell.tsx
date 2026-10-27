/**
 * ThemeShell — server wrapper that mounts the ThemeView context
 * (doc 25 §1.4 / §2.2, wave S3a).
 *
 * Mounted in the root layout around the client StorefrontShell. It
 * resolves the store theme ONCE per render (catalog + store pointer
 * + stored options — see src/themes/resolution-server.ts) and hands
 * the plain serialisable ThemeView to ThemeViewProvider, so leaf
 * components can read the active package id / options via
 * useThemeView() and composition roots can resolve slot components.
 *
 * It renders NO markup of its own (the provider is context-only), so
 * mounting it changes nothing visually — on any route. It reads only
 * store-global cached data: no cookies(), no headers(), so the root
 * layout stays ISR-eligible exactly as before. Header/Footer slot
 * rendering itself stays in the client shell (it owns the pathname
 * gating and the client-side category/menu fetches); this wrapper
 * only supplies the resolved view those slots are picked by.
 */
import type { ReactNode } from "react";
import { ThemeViewProvider } from "@/themes/theme-view";
import { resolveStorefrontThemeFromStore } from "@/themes/resolution-server";

export default async function ThemeShell({ children }: { children: ReactNode }) {
  const { themeView } = await resolveStorefrontThemeFromStore();
  return <ThemeViewProvider view={themeView}>{children}</ThemeViewProvider>;
}
