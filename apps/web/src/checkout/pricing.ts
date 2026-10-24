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
};

export type PricingBreakdown = {
  subtotalPoisha: number;
  couponDiscountPoisha: number;
  shippingPoisha: number;
  codFeePoisha: number;
  taxPoisha: number;
  grandTotalPoisha: number;
};

export function computePricing(input: PricingInput): PricingBreakdown {
  const taxable = Math.max(
    0,
    input.itemsSubtotalPoisha - input.couponDiscountPoisha,
  );
  // Integer-only tax: basis points keep this exact without floats.
  const taxPoisha = Math.round((taxable * input.taxBps) / 10000);
  const grandTotalPoisha =
    taxable + input.shippingPoisha + input.codFeePoisha + taxPoisha;
  return {
    subtotalPoisha: input.itemsSubtotalPoisha,
    couponDiscountPoisha: input.couponDiscountPoisha,
    shippingPoisha: input.shippingPoisha,
    codFeePoisha: input.codFeePoisha,
    taxPoisha,
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
