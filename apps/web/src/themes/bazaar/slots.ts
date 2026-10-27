/**
 * Bazaar full slot map (doc 25 §1.1 package layout, waves S4a + S4b).
 *
 * Server-side map, mirroring aurora/slots.ts. S4a filled Header,
 * Footer (re-exported from the client-safe shell map) and
 * ProductCard; S4b adds the remaining server slots — HomeSections
 * (home-sections.tsx), PdpComposition (pdp-composition.tsx) and
 * CartPage (cart-page.tsx — the platform's CartPageClient inside
 * the package frame; cart logic is never forked). The client-only
 * slots live in their own registries: ShopChrome in
 * client-shop-registry.tsx, CartDrawer in client-slot-registry.tsx,
 * the checkout skin in skin-registry.ts. The registry types this
 * as a Partial map and getThemeSlots() falls back to Aurora per
 * slot, so any future slot still resolves safely.
 */
import { BAZAAR_SHELL_SLOTS } from "./shell-slots";
import { BazaarProductCard } from "./product-card";
import BazaarHomeSections from "./home-sections";
import BazaarPdpComposition from "./pdp-composition";
import BazaarCartPage from "./cart-page";
import type { ThemeSlots } from "../slots";

export const BAZAAR_SLOTS: Partial<ThemeSlots> = {
  Header: BAZAAR_SHELL_SLOTS.Header,
  Footer: BAZAAR_SHELL_SLOTS.Footer,
  ProductCard: BazaarProductCard,
  HomeSections: BazaarHomeSections,
  PdpComposition: BazaarPdpComposition,
  CartPage: BazaarCartPage,
};
