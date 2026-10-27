/**
 * Aurora full slot map (doc 25 §1.1 package layout, waves S3a + S3b).
 *
 * Server-side map: Header + Footer (re-exported from the client-safe
 * shell map), HomeSections — today's home composition, moved
 * verbatim into ./home-sections.tsx — plus (S3b) ProductCard (the
 * platform's existing shared card, registered in place),
 * PdpComposition (today's PDP arrangement, moved verbatim into
 * ./pdp-composition.tsx) and CartPage (the existing CartPageClient,
 * registered in place: it IS the cart composition). Consumed through
 * src/themes/slot-registry.ts (getThemeSlots), which applies the
 * per-slot Aurora fallback for other packages.
 *
 * SERVER-ONLY by transitivity: ./home-sections renders async server
 * sections. Never import this module from a client component — the
 * client shell uses src/themes/client-slot-registry.ts instead.
 */
import { ProductCard } from "@/catalog/ProductCard";
import CartPageClient from "@/cart/components/CartPageClient";
import AuroraHomeSections from "./home-sections";
import AuroraPdpComposition from "./pdp-composition";
import { AURORA_SHELL_SLOTS } from "./shell-slots";
import type { ThemeSlots } from "../slots";

export const AURORA_SLOTS: ThemeSlots = {
  Header: AURORA_SHELL_SLOTS.Header,
  Footer: AURORA_SHELL_SLOTS.Footer,
  HomeSections: AuroraHomeSections,
  ProductCard,
  PdpComposition: AuroraPdpComposition,
  CartPage: CartPageClient,
};
