/**
 * Theme slot registry — SERVER side (doc 25 §1.4, §4.4; wave S3a).
 *
 * Maps a package id to its slot components, with PER-SLOT Aurora
 * fallback: an unknown package id gets all-Aurora slots, and a
 * package that fills only some slots gets Aurora for the rest. A
 * corrupted store pointer or a half-built package therefore degrades
 * to Theme #1 slot-by-slot — never to a blank page.
 *
 * This module statically imports the HomeSections compositions,
 * which render async server sections — it must only be imported by
 * server components (composition roots: app/page.tsx, the PDP page
 * and the cart page). Client components use the client-safe
 * siblings: client-slot-registry.ts (Header/Footer + CartDrawer),
 * client-card-registry.ts (ProductCard) and client-shop-registry.ts
 * (ShopChrome).
 *
 * The component maps here are the ONLY place slot components are
 * registered. Manifests stay in the import-free registry.ts
 * (doc 25 D1): this file owns components, that file owns data.
 */
import { AURORA_SLOTS } from "./aurora/slots";
import { BAZAAR_SLOTS } from "./bazaar/slots";
import { DEFAULT_PACKAGE_ID } from "./registry";
import type { ThemeSlots } from "./slots";

/** Registered full slot maps, by package id. Aurora is the fallback. */
const PACKAGE_SLOTS: ReadonlyMap<string, Partial<ThemeSlots>> = new Map([
  [DEFAULT_PACKAGE_ID, AURORA_SLOTS],
  ["bazaar", BAZAAR_SLOTS],
]);

/**
 * Resolve the full slot map for a package. Every slot falls back to
 * Aurora independently when the package is unknown or does not fill
 * that slot.
 */
export function getThemeSlots(packageId: string | null | undefined): ThemeSlots {
  const own = packageId ? PACKAGE_SLOTS.get(packageId) : undefined;
  return {
    Header: own?.Header ?? AURORA_SLOTS.Header,
    Footer: own?.Footer ?? AURORA_SLOTS.Footer,
    HomeSections: own?.HomeSections ?? AURORA_SLOTS.HomeSections,
    ProductCard: own?.ProductCard ?? AURORA_SLOTS.ProductCard,
    PdpComposition: own?.PdpComposition ?? AURORA_SLOTS.PdpComposition,
    CartPage: own?.CartPage ?? AURORA_SLOTS.CartPage,
  };
}

/** The Aurora slot map itself — composition roots use its members
 *  as the ThemeBoundary fallback for the resolved slot. */
export { AURORA_SLOTS };
