/**
 * Shobji full slot map (doc 25 §1.1 package layout; doc 27 T-B).
 *
 * Server-side map, mirroring bazaar/slots.ts: Header + Footer are
 * re-exported from the client-safe shell map; ProductCard,
 * HomeSections, PdpComposition and CartPage come from this
 * package's own files. The client-only slots live in their own
 * registries: ShopChrome in client-shop-registry.tsx, CartDrawer
 * in client-slot-registry.tsx, the checkout skin in
 * skin-registry.ts. The registry types this as a Partial map and
 * getThemeSlots() falls back to Aurora per slot, so any future slot
 * still resolves safely.
 */
import { SHOBJI_SHELL_SLOTS } from "./shell-slots";
import { ShobjiProductCard } from "./product-card";
import ShobjiHomeSections from "./home-sections";
import ShobjiPdpComposition from "./pdp-composition";
import ShobjiCartPage from "./cart-page";
import type { ThemeSlots } from "../slots";

export const SHOBJI_SLOTS: Partial<ThemeSlots> = {
  Header: SHOBJI_SHELL_SLOTS.Header,
  Footer: SHOBJI_SHELL_SLOTS.Footer,
  ProductCard: ShobjiProductCard,
  HomeSections: ShobjiHomeSections,
  PdpComposition: ShobjiPdpComposition,
  CartPage: ShobjiCartPage,
};
