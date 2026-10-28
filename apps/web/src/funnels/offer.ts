/**
 * Funnel offer resolution — doc 34 §3.7/§3.8 (wave L8).
 *
 * One resolver for every funnel offer (order-step bump pricing is
 * L7's create-path twin of this; the upsell/downsell runtime here):
 * the step stores a product ref + a discount RULE, never a price.
 * This module resolves the offer against the LIVE catalog
 * (LandingCatalogProduct — the landing layer's allowlist shape, no
 * cost fields) at render time AND at amend time, so the price the
 * customer saw and the price the server charges are computed by
 * the same code from the same live data.
 *
 * Variant pick = the platform convention (landing render.ts +
 * funnel store): the pinned variant when still active, else the
 * first in-stock active variant, else the first active variant.
 *
 * Discount math: percent uses the codebase's percent convention
 * (Math.round(amount * pct / 100), cf. checkout advance rules);
 * fixed takes poisha off. A rule that would price the line at
 * <= 0 poisha makes the offer UNRESOLVABLE at order time (§3.8:
 * refused and skipped — never charged, never silently free).
 */
import type { LandingCatalogProduct } from "@/landing/types";
import type { StepOffer } from "./types";

export interface ResolvedStepOffer {
  productId: string;
  variantId: string;
  productSlug: string;
  title: { bn: string; en: string };
  imageUrl: string | null;
  sku: string;
  /** Variant attributes (may be empty for a standard variant). */
  attributes: Record<string, string>;
  stock: number;
  /** Live catalog unit price, integer poisha. */
  livePricePoisha: number;
  compareAtPoisha: number | null;
  /** Discount the step's rule takes off the live price (>= 0). */
  discountPoisha: number;
  /** What one unit actually charges: live - discount (>= 1). */
  finalPricePoisha: number;
}

/** The discount a rule takes off a live price, in poisha (>= 0). */
export function offerDiscountPoisha(offer: StepOffer, livePricePoisha: number): number {
  if (!offer.discount) return 0;
  if (offer.discount.kind === "percent") {
    return Math.round((livePricePoisha * offer.discount.pct) / 100);
  }
  return offer.discount.poisha;
}

/**
 * Resolve an offer against a by-id catalog read (the caller passes
 * the products it fetched — normally exactly the offer's product).
 * Returns null when the product/variant does not resolve or the
 * discount rule would price the line at <= 0.
 */
export function resolveStepOffer(
  offer: StepOffer,
  catalog: readonly LandingCatalogProduct[],
): ResolvedStepOffer | null {
  const product = catalog.find((p) => p.id === offer.productId);
  if (!product) return null;
  const pinned = offer.variantId ? product.variants.find((v) => v.id === offer.variantId) : undefined;
  const variant =
    (pinned && pinned.isActive ? pinned : undefined) ??
    product.variants.find((v) => v.isActive && v.stock > 0) ??
    product.variants.find((v) => v.isActive) ??
    null;
  if (!variant) return null;
  const livePricePoisha = variant.pricePoisha;
  const discountPoisha = offerDiscountPoisha(offer, livePricePoisha);
  const finalPricePoisha = livePricePoisha - discountPoisha;
  if (finalPricePoisha < 1) return null; // §3.8 — refused at order time, logged by the caller
  return {
    productId: product.id,
    variantId: variant.id,
    productSlug: product.slug,
    title: product.title,
    imageUrl: variant.imageUrl ?? product.images[0]?.url ?? null,
    sku: variant.sku,
    attributes: variant.attributes,
    stock: variant.stock,
    livePricePoisha,
    compareAtPoisha: variant.compareAtPoisha,
    discountPoisha,
    finalPricePoisha,
  };
}
