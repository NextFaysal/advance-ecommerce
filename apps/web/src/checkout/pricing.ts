// Pricing pipeline — single source of truth for totals, integer poisha only.
// Pipeline (platform spec): subtotal -> item discounts -> coupon/campaign ->
// shipping -> COD fee -> tax/VAT -> grand total.
// SERVER-SIDE RE-VALIDATION (mandatory, not yet wired to an API route):
//   1. Re-fetch every variant price + stock from the DB; never trust client prices.
//   2. Re-apply coupon rules (expiry, min cart, product/category scope, usage limit).
//   3. Re-compute shipping by zone/weight and COD fee by payment method.
//   4. If any client total differs, reject with the server total, do not silently adjust.
//   5. Create the order inside one DB transaction (see orders/SCHEMA-ADDITIONS.md).

export type PricingInput = {
  /** Item subtotal in poisha, after per-item discounts. */
  itemsSubtotalPoisha: number;
  couponDiscountPoisha: number;
  shippingPoisha: number;
  codFeePoisha: number;
  /** Tax/VAT in basis points (e.g. 500 = 5%). 0 = no tax. */
  taxBps: number;
  /**
   * Membership-tier merchandise discount (ADV-18), in the same
   * discount stage as the coupon: it reduces the taxable base
   * alongside (and after) the coupon. Defaults to 0 — existing
   * callers are unaffected. The breakdown reports it separately so
   * surfaces that show the coupon alone keep their meaning.
   */
  tierDiscountPoisha?: number;
  /**
   * Gift-card amount applied to this order (ADV-18): a stored-value
   * tender applied AFTER tax, reducing the amount due — never below
   * 0. Defaults to 0.
   */
  giftCardAppliedPoisha?: number;
};

export type PricingBreakdown = {
  subtotalPoisha: number;
  couponDiscountPoisha: number;
  tierDiscountPoisha: number;
  shippingPoisha: number;
  codFeePoisha: number;
  taxPoisha: number;
  giftCardAppliedPoisha: number;
  grandTotalPoisha: number;
};

export function computePricing(input: PricingInput): PricingBreakdown {
  const tierDiscountPoisha = Math.min(
    Math.max(0, input.itemsSubtotalPoisha - input.couponDiscountPoisha),
    Math.max(0, input.tierDiscountPoisha ?? 0),
  );
  const taxable = Math.max(
    0,
    input.itemsSubtotalPoisha - input.couponDiscountPoisha - tierDiscountPoisha,
  );
  // Integer-only tax: basis points keep this exact without floats.
  const taxPoisha = Math.round((taxable * input.taxBps) / 10000);
  const preGiftCardTotalPoisha =
    taxable + input.shippingPoisha + input.codFeePoisha + taxPoisha;
  const giftCardAppliedPoisha = Math.min(
    preGiftCardTotalPoisha,
    Math.max(0, input.giftCardAppliedPoisha ?? 0),
  );
  const grandTotalPoisha = preGiftCardTotalPoisha - giftCardAppliedPoisha;
  return {
    subtotalPoisha: input.itemsSubtotalPoisha,
    couponDiscountPoisha: input.couponDiscountPoisha,
    tierDiscountPoisha,
    shippingPoisha: input.shippingPoisha,
    codFeePoisha: input.codFeePoisha,
    taxPoisha,
    giftCardAppliedPoisha,
    grandTotalPoisha,
  };
}

/** Display helper: poisha -> "৳1,234.00". Formatting only, never storage. */
export function formatBdt(poisha: number): string {
  return `৳${(poisha / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
