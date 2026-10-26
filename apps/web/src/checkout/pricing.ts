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
  /**
   * Rental security deposit (ADV-23 vertical 3): a REFUNDABLE
   * charge added to the amount due when the order carries a rental
   * (src/rental — the amount is computed by prepareRentalBooking
   * from rental.config + the rental line's price and frozen on the
   * RentalBooking row). It is added AFTER the gift-card stage on
   * purpose: a gift card is store credit for purchases and can
   * never cover a deposit the merchant must be able to hand back
   * in cash. The breakdown reports it as its own line
   * (ভাড়ার জামানত / Rental deposit). Defaults to 0 — every
   * non-rental caller is unaffected.
   */
  rentalDepositPoisha?: number;
  /**
   * Print-on-demand print fee (ADV-23 vertical 5): the per-item
   * fee from pod.config × the POD line's quantity, computed by
   * preparePodCustomisation (src/pod) and frozen on the order's
   * create-time note. It joins the pipeline at the SAME stage as
   * the rental deposit — after the gift-card stage, as its own
   * breakdown line (প্রিন্ট ফি / Print fee), included in the grand
   * total — so every surface decomposes the two add-on charges
   * identically. Defaults to 0 — every non-POD caller is
   * unaffected.
   */
  printFeePoisha?: number;
};

export type PricingBreakdown = {
  subtotalPoisha: number;
  couponDiscountPoisha: number;
  tierDiscountPoisha: number;
  shippingPoisha: number;
  codFeePoisha: number;
  taxPoisha: number;
  giftCardAppliedPoisha: number;
  /** Rental security deposit line (ADV-23) — 0 for non-rental
   *  orders; see PricingInput.rentalDepositPoisha. */
  rentalDepositPoisha: number;
  /** Print-on-demand print fee line (ADV-23 vertical 5) — 0 for
   *  non-POD orders; see PricingInput.printFeePoisha. */
  printFeePoisha: number;
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
  // ADV-23 rental deposit: added after the gift-card stage (the
  // gift-card cap above is computed WITHOUT it, so store credit can
  // never absorb the refundable deposit) and included in the grand
  // total the customer actually pays.
  const rentalDepositPoisha = Math.max(0, input.rentalDepositPoisha ?? 0);
  // ADV-23 vertical 5 print fee: same stage as the deposit (after
  // the gift-card cap, which is computed without it) and included
  // in the grand total the customer actually pays.
  const printFeePoisha = Math.max(0, input.printFeePoisha ?? 0);
  const grandTotalPoisha =
    preGiftCardTotalPoisha - giftCardAppliedPoisha + rentalDepositPoisha + printFeePoisha;
  return {
    subtotalPoisha: input.itemsSubtotalPoisha,
    couponDiscountPoisha: input.couponDiscountPoisha,
    tierDiscountPoisha,
    shippingPoisha: input.shippingPoisha,
    codFeePoisha: input.codFeePoisha,
    taxPoisha,
    giftCardAppliedPoisha,
    rentalDepositPoisha,
    printFeePoisha,
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
