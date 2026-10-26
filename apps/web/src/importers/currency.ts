// Exact decimal money handling for non-BDT source files (ADV-25).
//
// Source prices are decimal strings in the source currency's major
// unit ("19.99"). Conversion to BDT major happens ONLY with an
// admin-supplied rate, using BigInt decimal math (never floats) and
// half-up rounding at the second decimal — the same convention as the
// catalog pipeline's taka -> poisha conversion. The converted string
// is then handed to the pipeline as price_taka, so the final poisha
// value is produced by the pipeline's own exact conversion.

interface DecimalParts {
  digits: bigint;
  scale: number; // value = digits / 10^scale
}

export function parseDecimal(value: string): DecimalParts | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const frac = match[2] ?? "";
  return { digits: BigInt((match[1] as string) + frac), scale: frac.length };
}

/** True when the string is a plain non-negative decimal amount. */
export function isDecimalAmount(value: string): boolean {
  return parseDecimal(value) !== null;
}

/**
 * amount (source major) x rate (BDT per unit) -> BDT major string with
 * exactly 2 decimals, half-up. Returns null when either side is not a
 * plain decimal — callers treat null as "cannot convert" and leave
 * the price empty so the pipeline reports the row, instead of writing
 * a guessed price.
 */
export function convertMajorToBdt(amount: string, rate: string): string | null {
  const a = parseDecimal(amount);
  const r = parseDecimal(rate);
  if (!a || !r) return null;
  let digits = a.digits * r.digits;
  const scale = a.scale + r.scale;
  if (scale > 2) {
    const divisor = 10n ** BigInt(scale - 2);
    const quotient = digits / divisor;
    const remainder = digits % divisor;
    digits = remainder * 2n >= divisor ? quotient + 1n : quotient;
  } else if (scale < 2) {
    digits = digits * 10n ** BigInt(2 - scale);
  }
  const text = digits.toString().padStart(3, "0");
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
}

/**
 * Compare two plain decimal strings: -1 / 0 / 1, or null when either
 * is not a plain decimal. Used for sale/compare-at decisions so a
 * "compare at" price is only recorded when it is genuinely higher.
 */
export function compareDecimal(a: string, b: string): number | null {
  const da = parseDecimal(a);
  const db = parseDecimal(b);
  if (!da || !db) return null;
  const scale = Math.max(da.scale, db.scale);
  const va = da.digits * 10n ** BigInt(scale - da.scale);
  const vb = db.digits * 10n ** BigInt(scale - db.scale);
  return va < vb ? -1 : va > vb ? 1 : 0;
}

/**
 * Price-cell resolver for the mappers. In BDT mode the cell passes
 * through untouched (the pipeline validates it). In conversion mode
 * the cell is converted; an unconvertible cell becomes "" (the
 * pipeline then reports the row as price-missing) and the failure is
 * counted on the returned stats so the report can say so.
 */
export interface PriceCellStats {
  convertedCells: number;
  failedCells: number;
}

export function resolvePriceCell(
  raw: string,
  currency: { source: string; rate: string | null },
  stats: PriceCellStats,
): string {
  const cell = raw.trim();
  if (cell === "") return "";
  if (currency.source === "BDT") return cell;
  const converted = convertMajorToBdt(cell, currency.rate ?? "");
  if (converted === null) {
    stats.failedCells += 1;
    return "";
  }
  stats.convertedCells += 1;
  return converted;
}
