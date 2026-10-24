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
// - Demo coupons mirror the admin marketing page SAMPLE rows / DB seed
//   (WELCOME10: 10%, cap 50000 poisha) — applied via src/marketing/service.
// All money is integer poisha. Prices on the cart item are add-time
// snapshots; checkout re-validates server-side (see checkout/pricing.ts).

import type { PublicProduct, PublicVariant } from "@/catalog/types";
import type { CouponRecord } from "@/marketing/service";
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

/** Per-unit item discounts summed over the cart, in poisha. */
export function cartItemDiscountPoisha(lines: ResolvedCartLine[]): number {
  return lines.reduce(
    (sum, line) => sum + line.discountPoishaPerUnit * line.item.quantity,
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

// Demo coupon records — same SAMPLE data as the admin marketing page /
// DB seed. Applied with the real applyCoupon() from src/marketing/service;
// labelled DEMO on the page because there is no live coupon API read yet.
export const DEMO_COUPONS: CouponRecord[] = [
  {
    id: "cpn_sample_welcome10",
    code: "WELCOME10",
    type: "percent",
    valuePercent: 10,
    valuePoisha: null,
    minCartPoisha: null,
    maxDiscountPoisha: 50000,
    usageLimit: null,
    perUserLimit: 1,
    startsAt: null,
    endsAt: null,
    stackable: false,
    isActive: true,
    usedCount: 132,
    usedByUser: {},
  },
  {
    id: "cpn_sample_fixed200",
    code: "SAMPLE-FIXED200",
    type: "fixed",
    valuePercent: null,
    valuePoisha: 20000,
    minCartPoisha: 100000,
    maxDiscountPoisha: null,
    usageLimit: 500,
    perUserLimit: null,
    startsAt: null,
    endsAt: null,
    stackable: false,
    isActive: true,
    usedCount: 41,
    usedByUser: {},
  },
];

export function findDemoCoupon(code: string): CouponRecord | null {
  const normalized = code.trim().toUpperCase();
  return DEMO_COUPONS.find((c) => c.code === normalized) ?? null;
}

export const COUPON_REASON_BN: Record<string, string> = {
  coupon_inactive: "কুপনটি এখন সক্রিয় নয়।",
  coupon_not_started: "কুপনটি এখনো শুরু হয়নি।",
  coupon_expired: "কুপনের মেয়াদ শেষ হয়ে গেছে।",
  min_cart_not_met: "এই কুপনের জন্য ন্যূনতম কার্ট মূল্য পূরণ হয়নি।",
  usage_limit_reached: "কুপনের ব্যবহারের সীমা শেষ হয়ে গেছে।",
  per_user_limit_reached: "আপনি এই কুপনের সীমা পর্যন্ত ব্যবহার করেছেন।",
  not_first_order: "এই কুপন শুধু প্রথম অর্ডারের জন্য।",
  not_stackable: "এই কুপন অন্য কুপনের সাথে ব্যবহার করা যাবে না।",
  not_found: "কুপন কোড পাওয়া যায়নি। (ডেমো কোড: WELCOME10)",
};

// NOTE: the old TEMPORARY DEMO cart (seeded from the mock catalog) is
// gone — with the real catalog wired, a browser without a guest cart
// sees the honest empty-cart state. Nothing fabricates cart items.
