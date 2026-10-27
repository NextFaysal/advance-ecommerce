/**
 * Boighor full slot map (doc 25 §1.1 package layout, doc 27 T-C).
 *
 * Server-side map, mirroring bazaar/slots.ts: Header + Footer are
 * re-exported from the client-safe shell map; ProductCard,
 * HomeSections, PdpComposition and CartPage (the platform's
 * CartPageClient inside the package frame; cart logic is never
 * forked) complete the server slots. The client-only slots live
 * in their own registries: ShopChrome in
 * client-shop-registry.tsx, CartDrawer in client-slot-registry.tsx,
 * the checkout skin in skin-registry.ts. The registry types this
 * as a Partial map and getThemeSlots() falls back to Aurora per
 * slot, so any future slot still resolves safely.
 */
import { BOIGHOR_SHELL_SLOTS } from "./shell-slots";
import { BoighorProductCard } from "./product-card";
import BoighorHomeSections from "./home-sections";
import BoighorPdpComposition from "./pdp-composition";
import BoighorCartPage from "./cart-page";
import type { ThemeSlots } from "../slots";

export const BOIGHOR_SLOTS: Partial<ThemeSlots> = {
  Header: BOIGHOR_SHELL_SLOTS.Header,
  Footer: BOIGHOR_SHELL_SLOTS.Footer,
  ProductCard: BoighorProductCard,
  HomeSections: BoighorHomeSections,
  PdpComposition: BoighorPdpComposition,
  CartPage: BoighorCartPage,
};
