/**
 * Haat full slot map (doc 25 §1.1 package layout, doc 27 T-A).
 *
 * Server-side map, mirroring bazaar/slots.ts: Header + Footer
 * are re-exported from the client-safe shell map; ProductCard,
 * HomeSections, PdpComposition and CartPage are this package's
 * own server-resolved slots. The client-only slots live in
 * their own registries: ShopChrome in client-shop-registry.tsx,
 * CartDrawer in client-slot-registry.tsx, the checkout skin in
 * skin-registry.ts. The registry types this as a Partial map
 * and getThemeSlots() falls back to Aurora per slot, so any
 * future slot still resolves safely.
 */
import { HAAT_SHELL_SLOTS } from "./shell-slots";
import { HaatProductCard } from "./product-card";
import HaatHomeSections from "./home-sections";
import HaatPdpComposition from "./pdp-composition";
import HaatCartPage from "./cart-page";
import type { ThemeSlots } from "../slots";

export const HAAT_SLOTS: Partial<ThemeSlots> = {
  Header: HAAT_SHELL_SLOTS.Header,
  Footer: HAAT_SHELL_SLOTS.Footer,
  ProductCard: HaatProductCard,
  HomeSections: HaatHomeSections,
  PdpComposition: HaatPdpComposition,
  CartPage: HaatCartPage,
};
