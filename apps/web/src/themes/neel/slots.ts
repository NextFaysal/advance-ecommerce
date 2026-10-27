/**
 * Neel full slot map (doc 25 §1.1 package layout; doc 27 T-E).
 *
 * Server-side map, mirroring bazaar/slots.ts: Header + Footer
 * (re-exported from the client-safe shell map), ProductCard,
 * HomeSections, PdpComposition and CartPage (the platform's
 * CartPageClient inside the package frame; cart logic is never
 * forked). The client-only slots live in their own registries:
 * ShopChrome in client-shop-registry.tsx, CartDrawer in
 * client-slot-registry.tsx, the checkout skin in skin-registry.ts.
 * The registry types this as a Partial map and getThemeSlots()
 * falls back to Aurora per slot, so any future slot still
 * resolves safely.
 */
import { NEEL_SHELL_SLOTS } from "./shell-slots";
import { NeelProductCard } from "./product-card";
import NeelHomeSections from "./home-sections";
import NeelPdpComposition from "./pdp-composition";
import NeelCartPage from "./cart-page";
import type { ThemeSlots } from "../slots";

export const NEEL_SLOTS: Partial<ThemeSlots> = {
  Header: NEEL_SHELL_SLOTS.Header,
  Footer: NEEL_SHELL_SLOTS.Footer,
  ProductCard: NeelProductCard,
  HomeSections: NeelHomeSections,
  PdpComposition: NeelPdpComposition,
  CartPage: NeelCartPage,
};
