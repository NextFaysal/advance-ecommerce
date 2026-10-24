// Pricing pipeline — single source of truth (Master Prompt rule).
// Order, always in integer poisha:
//   subtotal -> item discounts -> coupon/campaign -> shipping -> COD fee -> tax/VAT -> grand total
// No float money anywhere. Percent math rounds once per line to the nearest poisha.

export interface CartLine {
  variantId: string;
  /** Integer poisha, unit selling price BEFORE line discount */
  unitPricePoisha: number;
  /** Integer poisha per unit, e.g. sale / compare-at difference already applied by caller */
  discountPoishaPerUnit?: number;
  quantity: number;
}

export type CouponKind = "PERCENT" | "FIXED" | "FREE_SHIPPING";

export interface CouponInput {
  code: string;
  kind: CouponKind;
  /** PERCENT: 0-100. FIXED: integer poisha. FREE_SHIPPING: ignored value */
  value: number;
  /** Integer poisha, optional minimum order value to apply */
  minOrderPoisha?: number;
}

export interface PricingInput {
  lines: CartLine[];
  coupon?: CouponInput | null;
  /** Integer poisha */
  shippingPoisha: number;
  /** Integer poisha, 0 for prepaid */
  codFeePoisha: number;
  /** VAT/tax percent, e.g. 0, 5, 15 — applied on (after-coupon + shipping + COD fee) */
  taxPercent: number;
}

export interface PricingResult {
  subtotalPoisha: number;
  itemDiscountPoisha: number;
  couponDiscountPoisha: number;
  shippingPoisha: number;
  codFeePoisha: number;
  taxPoisha: number;
  grandTotalPoisha: number;
  /** True when a coupon was supplied but min-order was not met */
  couponRejectedForMinOrder: boolean;
}

function clampNonNegative(value: number): number {
  return value < 0 ? 0 : value;
}

function percentOfPoisha(basePoisha: number, percent: number): number {
  return Math.round((basePoisha * percent) / 100);
}

export function calculatePricing(input: PricingInput): PricingResult {
  let subtotalPoisha = 0;
  let itemDiscountPoisha = 0;

  for (const line of input.lines) {
    const qty = Math.max(0, Math.floor(line.quantity));
    subtotalPoisha += line.unitPricePoisha * qty;
    itemDiscountPoisha += (line.discountPoishaPerUnit ?? 0) * qty;
  }
  itemDiscountPoisha = Math.min(itemDiscountPoisha, subtotalPoisha);
  const afterItemDiscount = subtotalPoisha - itemDiscountPoisha;

  let couponDiscountPoisha = 0;
  let couponRejectedForMinOrder = false;
  let shippingPoisha = input.shippingPoisha;

  if (input.coupon) {
    const coupon = input.coupon;
    if (coupon.minOrderPoisha !== undefined && afterItemDiscount < coupon.minOrderPoisha) {
      couponRejectedForMinOrder = true;
    } else if (coupon.kind === "PERCENT") {
      couponDiscountPoisha = percentOfPoisha(afterItemDiscount, coupon.value);
    } else if (coupon.kind === "FIXED") {
      couponDiscountPoisha = Math.min(coupon.value, afterItemDiscount);
    } else if (coupon.kind === "FREE_SHIPPING") {
      shippingPoisha = 0;
    }
  }
  couponDiscountPoisha = Math.min(couponDiscountPoisha, afterItemDiscount);

  const afterCoupon = afterItemDiscount - couponDiscountPoisha;
  const codFeePoisha = input.codFeePoisha;
  const taxableBase = afterCoupon + shippingPoisha + codFeePoisha;
  const taxPoisha = percentOfPoisha(taxableBase, input.taxPercent);
  const grandTotalPoisha = clampNonNegative(taxableBase + taxPoisha);

  return {
    subtotalPoisha,
    itemDiscountPoisha,
    couponDiscountPoisha,
    shippingPoisha,
    codFeePoisha,
    taxPoisha,
    grandTotalPoisha,
    couponRejectedForMinOrder,
  };
}

/** Example (used by tests/docs, not by checkout): ৳1,000 x 2, 10% coupon, ৳60 shipping, ৳0 COD, 0% tax. */
export function examplePricing(): PricingResult {
  return calculatePricing({
    lines: [{ variantId: "v1", unitPricePoisha: 100000, quantity: 2 }],
    coupon: { code: "EID10", kind: "PERCENT", value: 10 },
    shippingPoisha: 6000,
    codFeePoisha: 0,
    taxPercent: 0,
  });
  // subtotal 200000, coupon 20000, shipping 6000, grand total 186000 (৳1,860.00)
}
