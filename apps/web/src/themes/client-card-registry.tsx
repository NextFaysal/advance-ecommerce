/**
 * Theme slot registry — CLIENT-safe ProductCard (doc 25 §1.4; wave S3b).
 *
 * A sibling module (not part of client-slot-registry) on purpose:
 * ThemedProductCard is rendered by leaf consumers all over the
 * storefront (home rails, search, related rails), and those bundles
 * must not drag the shop chrome or drawer chains in with the card.
 * This module imports exactly one component chain: the card itself.
 *
 * Aurora's ProductCard IS the platform's existing
 * src/catalog/ProductCard, registered in place — its props already
 * ARE the slot contract (see src/themes/slots.ts).
 *
 * Fallback discipline matches the other registries (doc 25 §4.4):
 * unknown package or missing slot → Aurora's card.
 */
import { ProductCard } from "@/catalog/ProductCard";
import { BazaarProductCard } from "./bazaar/product-card";
import { DEFAULT_PACKAGE_ID } from "./registry";
import type { ThemeProductCardSlot } from "./slots";

/** Registered ProductCard slots, by package id. Aurora is the fallback. */
const PACKAGE_PRODUCT_CARDS: ReadonlyMap<string, ThemeProductCardSlot> = new Map([
  [DEFAULT_PACKAGE_ID, ProductCard],
  ["bazaar", BazaarProductCard],
]);

/** Resolve the ProductCard slot for a package (Aurora on any miss). */
export function getProductCardSlot(
  packageId: string | null | undefined,
): ThemeProductCardSlot {
  return (
    (packageId ? PACKAGE_PRODUCT_CARDS.get(packageId) : undefined) ??
    ProductCard
  );
}

/** Aurora's ProductCard — the existing shared card, unchanged. */
export const AURORA_PRODUCT_CARD = ProductCard;
