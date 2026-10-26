/**
 * Fractional quantities — doc 23 wave 59.
 *
 * THE DISCIPLINE (one rule set for the whole order/cart path):
 *
 *  - STORAGE: OrderItem.quantity, CartItem.quantity, ReturnItem.quantity
 *    and Subscription.quantity are Decimal(12, 3) in Postgres
 *    (migration 20261026024000_fractional_quantities). Prisma hands them
 *    back as Prisma.Decimal (decimal.js) objects.
 *  - MATH: quantities are converted to INTEGER MILLI-UNITS
 *    (qty × 1000) for every computation. Money stays integer poisha and
 *    a line total is computed ONCE, at the line level:
 *        lineTotalPoisha = roundHalfUp(unitPricePoisha × qtyMilli / 1000)
 *    A single rounding point per line — the same "integer math, round
 *    once at the end" discipline the ADV-22 grocery pack uses for its
 *    derived pack prices (priceForWeight floors rate × grams / 1000 in
 *    one step; the order path rounds half-up per the wave-59 brief).
 *    Integer quantities are exact under this rule (×1000 then ÷1000),
 *    so non-weighted behaviour is byte-identical to before.
 *  - APP VALUES: in TypeScript, a quantity is a plain number that is
 *    ALWAYS milli-exact (a multiple of 0.001). Anything read from
 *    Prisma/a wire payload goes through qtyNumber()/qtyToMilli() once
 *    at the seam, which re-canonicalises it; raw float arithmetic on
 *    quantities (0.1 + 0.2 style) is forbidden — use addQty/subQty.
 *  - WIRE: wherever a quantity crosses an API boundary it is serialised
 *    as a STRING ("1.5", "2", "0.25") via qtyToString() — never a
 *    float, so "0.30000000000000004" can never leak to a client.
 *  - STOCK: stock columns stay integer units. A fractional line can
 *    only exist on a grocery weighted variant (validated server-side,
 *    src/orders/quantity-rules.ts); its stock claim/release/restock
 *    moves in WHOLE packs via stockClaimUnits() = ceil(qty) — the
 *    platform never oversells the last partial pack, and the release
 *    path recomputes from the same ledger movements, so claims and
 *    releases stay symmetric. Batch/serial depletion SKIPS fractional
 *    lines (lots and serials are whole units; see
 *    src/inventory/batches.ts).
 *
 * This module is pure and import-safe from client components (no
 * server-only dependencies); Decimal inputs are accepted structurally
 * (anything with a decimal string form), so no Prisma import is needed.
 */

/** Decimal places a quantity may carry (Decimal(12, 3)). */
export const QTY_DECIMALS = 3;
/** Milli-units per unit: qty × QTY_MILLI is always an integer. */
export const QTY_MILLI = 1000;
/** Sanity ceiling for a single line quantity (stock gates bind first). */
export const QTY_MAX = 100_000;

/** Anything that carries a quantity: number, wire string, or Prisma.Decimal. */
export type QtyInput = number | string | { toString(): string };

/** Quantity -> integer milli-units. The ONLY conversion money math trusts. */
export function qtyToMilli(q: QtyInput): number {
  const n = typeof q === "number" ? q : Number(String(q));
  return Math.round(n * QTY_MILLI);
}

/** Integer milli-units -> canonical app number (multiple of 0.001). */
export function milliToQty(milli: number): number {
  return milli / QTY_MILLI;
}

/** Any quantity input -> the canonical milli-exact app number. */
export function qtyNumber(q: QtyInput): number {
  return milliToQty(qtyToMilli(q));
}

/**
 * Canonical wire/display string for a quantity: "2", "1.5", "0.25".
 * Trailing zeros are trimmed; never a float artefact.
 */
export function qtyToString(q: QtyInput): string {
  const milli = qtyToMilli(q);
  const sign = milli < 0 ? "-" : "";
  const abs = Math.abs(milli);
  const whole = Math.floor(abs / QTY_MILLI);
  const frac = abs % QTY_MILLI;
  if (frac === 0) return `${sign}${whole}`;
  const fracStr = String(frac).padStart(3, "0").replace(/0+$/, "");
  return `${sign}${whole}.${fracStr}`;
}

/** Value to hand Prisma for a Decimal(12, 3) column: the canonical string. */
export function qtyToDecimalString(q: QtyInput): string {
  return qtyToString(q);
}

/** True when the quantity is not a whole number of units. */
export function isFractionalQty(q: QtyInput): boolean {
  return qtyToMilli(q) % QTY_MILLI !== 0;
}

/**
 * Shape check for an incoming quantity NUMBER (zod-level): finite,
 * > 0 (or >= 0 when allowZero), at most 3 decimal places, under the
 * sanity ceiling. Sub-milli float noise (e.g. 0.30000000000000004 from
 * browser arithmetic) is within tolerance and canonicalises to the
 * exact milli value downstream; a genuinely 4+ decimal value is
 * rejected. Weighted/step gating is a separate server concern
 * (src/orders/quantity-rules.ts) — this only proves the value can be
 * represented in Decimal(12, 3).
 */
export function isValidQtyNumber(n: unknown, opts?: { allowZero?: boolean }): n is number {
  if (typeof n !== "number" || !Number.isFinite(n)) return false;
  if (opts?.allowZero ? n < 0 : n <= 0) return false;
  if (n > QTY_MAX) return false;
  return Math.abs(n * QTY_MILLI - Math.round(n * QTY_MILLI)) < 1e-6;
}

/** roundHalfUp(a / b) for non-negative integers a, b — no floats. */
export function roundHalfUpDiv(a: number, b: number): number {
  return Math.floor((a + Math.floor(b / 2)) / b);
}

/**
 * THE line-total rule: roundHalfUp(unitPricePoisha × qty), computed in
 * integer milli-units with the single rounding at the line level.
 * Integer qty -> exactly unitPricePoisha × qty (unchanged behaviour).
 */
export function lineTotalPoisha(unitPricePoisha: number, q: QtyInput): number {
  return roundHalfUpDiv(unitPricePoisha * qtyToMilli(q), QTY_MILLI);
}

/** Milli-exact quantity addition (never raw + on quantities). */
export function addQty(a: QtyInput, b: QtyInput): number {
  return milliToQty(qtyToMilli(a) + qtyToMilli(b));
}

/** Milli-exact quantity subtraction. */
export function subQty(a: QtyInput, b: QtyInput): number {
  return milliToQty(qtyToMilli(a) - qtyToMilli(b));
}

/** Milli-exact comparison: -1 / 0 / 1. */
export function cmpQty(a: QtyInput, b: QtyInput): number {
  const d = qtyToMilli(a) - qtyToMilli(b);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}

/**
 * Whole stock units a line claims/releases/restocks: identity for
 * integer quantities; ceil for fractional (weighted) lines — see the
 * header's STOCK rule. Every stock movement for an order line goes
 * through this so claims and releases stay symmetric.
 */
export function stockClaimUnits(q: QtyInput): number {
  const milli = qtyToMilli(q);
  return Math.ceil(milli / QTY_MILLI);
}

/**
 * Default PDP/cart step for a weighted variant when the grocery config
 * defines no weight step: half a pack.
 */
export const DEFAULT_WEIGHTED_STEP = 0.5;
