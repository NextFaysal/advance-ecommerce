/**
 * Circuit full slot map (doc 25 §1.1 package layout, doc 27 T-D).
 *
 * Server-side map, mirroring bazaar/slots.ts: Header and Footer
 * are re-exported from the client-safe shell map; ProductCard,
 * HomeSections (home-sections.tsx), PdpComposition
 * (pdp-composition.tsx) and CartPage (cart-page.tsx — the
 * platform's CartPageClient inside the package frame; cart logic
 * is never forked) fill the remaining server slots. The
 * client-only slots live in their own registries: ShopChrome in
 * client-shop-registry.tsx, CartDrawer in
 * client-slot-registry.tsx, the checkout skin in
 * skin-registry.ts. The registry types this as a Partial map and
 * getThemeSlots() falls back to Aurora per slot, so any future
 * slot still resolves safely.
 */
import { CIRCUIT_SHELL_SLOTS } from "./shell-slots";
import { CircuitProductCard } from "./product-card";
import CircuitHomeSections from "./home-sections";
import CircuitPdpComposition from "./pdp-composition";
import CircuitCartPage from "./cart-page";
import type { ThemeSlots } from "../slots";

export const CIRCUIT_SLOTS: Partial<ThemeSlots> = {
  Header: CIRCUIT_SHELL_SLOTS.Header,
  Footer: CIRCUIT_SHELL_SLOTS.Footer,
  ProductCard: CircuitProductCard,
  HomeSections: CircuitHomeSections,
  PdpComposition: CircuitPdpComposition,
  CartPage: CircuitCartPage,
};
