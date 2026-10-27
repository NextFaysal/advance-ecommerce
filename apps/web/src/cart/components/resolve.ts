// Cart page helpers — Agent 33 (Storefront Cart Page).
// Reuses the existing contracts, invents nothing new:
// - Cart state: src/cart/types + src/cart/persistence (guest localStorage).
// - Product resolution: the caller passes the real catalog list (the
//   cart page's server shell loads ACTIVE products from the Prisma
//   repository via src/catalog/server-read) and lines resolve by
//   productId / variantId, falling back to sku, then to the cart item's
//   own snapshot. Items whose product is no longer ACTIVE resolve as
//   snapshot-only lines — no mock data anywhere in this path.
// - Shipping zone charges mirror the DB seed zones (packages/db seed:
//   inside Dhaka 6000 poisha, outside Dhaka 12000 poisha).
// - Coupons are NOT resolved on this page: there is no public coupon
//   read API, so the cart only stores the submitted code and the real
//   DB coupon set is evaluated server-side at order create (see
//   src/checkout/order-enrichment.ts). No demo coupon records exist.
// All money is integer poisha. Prices on the cart item are add-time
// snapshots; checkout re-validates server-side (see checkout/pricing.ts).

import type { PublicProduct, PublicVariant } from "@/catalog/types";
import { lineTotalPoisha } from "@/lib/quantity";
import { CART_STRINGS } from "../strings";
import type { Cart, CartItem } from "../types";

export interface ResolvedCartLine {
  item: CartItem;
  /** Null when the item is not in the supplied catalog (snapshot-only line). */
  product: PublicProduct | null;
  variant: PublicVariant | null;
  productSlug: string | null;
  titleBn: string;
  variantLabel: string | null;
  /** Effective stock cap for the quantity stepper. */
  stockCap: number;
  outOfStock: boolean;
  /** Per-unit compare-at discount (compareAt - price) in poisha, 0 if none. */
  discountPoishaPerUnit: number;
}

export function resolveCartLine(item: CartItem, catalog: readonly PublicProduct[]): ResolvedCartLine {
  const product = catalog.find((p) => p.id === item.productId) ?? null;
  const variant =
    product?.variants.find((v) => v.id === item.variantId) ??
    product?.variants.find((v) => v.sku === item.sku) ??
    null;
  const stockCap = variant ? variant.stock : item.availableStock;
  const compareAt = variant?.compareAtPoisha ?? null;
  return {
    item,
    product,
    variant,
    productSlug: product?.slug ?? null,
    titleBn: product ? product.title.bn : item.name,
    variantLabel: variant
      ? Object.values(variant.attributes).join(" · ") || null
      : null,
    stockCap,
    outOfStock: stockCap <= 0,
    discountPoishaPerUnit:
      compareAt !== null && compareAt > item.unitPricePoisha
        ? compareAt - item.unitPricePoisha
        : 0,
  };
}

export function resolveCartLines(cart: Cart, catalog: readonly PublicProduct[]): ResolvedCartLine[] {
  return cart.items.map((item) => resolveCartLine(item, catalog));
}

/** Per-unit item discounts summed over the cart, in poisha (line-level rounding rule). */
export function cartItemDiscountPoisha(lines: ResolvedCartLine[]): number {
  return lines.reduce(
    (sum, line) => sum + lineTotalPoisha(line.discountPoishaPerUnit, line.item.quantity),
    0,
  );
}

// Shipping zones — charges match the seeded ShippingZone/ShippingRate rows.
export interface CartShippingZone {
  id: "inside_dhaka" | "outside_dhaka";
  labelBn: string;
  labelEn: string;
  chargePoisha: number;
}

export const CART_SHIPPING_ZONES: CartShippingZone[] = [
  { id: "inside_dhaka", labelBn: "ঢাকার ভিতরে", labelEn: "Inside Dhaka", chargePoisha: 6000 },
  { id: "outside_dhaka", labelBn: "ঢাকার বাইরে", labelEn: "Outside Dhaka", chargePoisha: 12000 },
];

// Coupon rejection reasons — shared with the server-side order
// enrichment, which maps applyCoupon() reason codes through these
// tables. Both locales live in src/cart/strings.ts (doc 30); the
// per-locale maps are derived from it so parity is compile-checked.
// There are deliberately NO coupon records in this module: the demo
// records that used to live here (WELCOME10 / SAMPLE-FIXED200) were
// removed (doc 21 G3-3) so a code resolves only when a real Coupon
// row exists in the DB.
const COUPON_REASON_KEYS = {
  coupon_inactive: "couponReasonInactive",
  coupon_not_started: "couponReasonNotStarted",
  coupon_expired: "couponReasonExpired",
  min_cart_not_met: "couponReasonMinCartNotMet",
  usage_limit_reached: "couponReasonUsageLimitReached",
  per_user_limit_reached: "couponReasonPerUserLimitReached",
  not_first_order: "couponReasonNotFirstOrder",
  not_stackable: "couponReasonNotStackable",
  not_found: "couponReasonNotFound",
} as const;

function couponReasonMap(locale: "bn" | "en"): Record<string, string> {
  const dict = CART_STRINGS[locale];
  return Object.fromEntries(
    Object.entries(COUPON_REASON_KEYS).map(([code, key]) => [code, dict[key]]),
  );
}

export const COUPON_REASON_BN: Record<string, string> = couponReasonMap("bn");
export const COUPON_REASON_EN: Record<string, string> = couponReasonMap("en");

// NOTE: the old TEMPORARY DEMO cart (seeded from the mock catalog) is
// gone — with the real catalog wired, a browser without a guest cart
// sees the honest empty-cart state. Nothing fabricates cart items.
