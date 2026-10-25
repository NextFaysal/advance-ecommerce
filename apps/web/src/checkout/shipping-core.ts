/**
 * Shipping engine — PURE core (doc 17 batch O2).
 *
 * This module is deliberately import-free so it is safe in BOTH the
 * server route and the browser: the checkout page uses
 * calculateShipping() with DEFAULT_SHIPPING_RATES for its preview,
 * while the server (src/checkout/shipping.ts) loads the live Settings
 * rates and runs the exact same math through computeOrderShipping().
 * Nothing here reads the DB, Settings, or the geo dataset JSON.
 *
 * ZONE RULE — the zone is DERIVED from the delivery district, never
 * picked by the customer:
 *   district "Dhaka" (or its common spellings) -> inside_dhaka
 *   any other / unknown district               -> outside_dhaka
 *   shippingMethod "pickup"                    -> pickup (always wins)
 * The non-pickup shippingMethod value the checkout schema carries is
 * accepted for compatibility but the district decides — a Chattogram
 * address can no longer be charged the Dhaka rate by picking the
 * "inside Dhaka" option (the pre-O2 behaviour this engine replaces).
 * An explicit `zone` in the input (staff/manual flows, where a human
 * chose the zone) wins over district derivation, except that "pickup"
 * as shippingMethod still wins over everything.
 *
 * WEIGHT SLABS — `weightSlabs` is a list of { upToGrams, addPoisha }
 * bands, applied PER STARTED BAND ABOVE THE BASE:
 *   - Entries are sorted ascending by upToGrams.
 *   - The FIRST entry is the base allowance: a total weight up to its
 *     upToGrams adds 0. (Its addPoisha is used only as the repeat rate
 *     when it is also the LAST entry — see below.)
 *   - Each subsequent entry is a band of width
 *     (upToGrams − previous upToGrams). If the weight enters the band
 *     at all — even by 1 gram — the band's addPoisha is charged IN
 *     FULL, and bands are cumulative: entering band 3 charges band 2
 *     and band 3.
 *   - Weight beyond the last entry repeats started bands of the last
 *     band's width (lastUpToGrams − previousUpToGrams, or lastUpToGrams
 *     when there is a single entry), each adding the last entry's
 *     addPoisha.
 *   Example: slabs [{1000, 0}, {3000, 2000}] → 900 g adds 0;
 *   2,500 g adds 2,000 (band 2 started); 10,000 g adds
 *   2,000 + ceil((10000−3000)/2000)×2,000 = 10,000.
 *   Empty slab list (the default) = no weight component at all.
 *
 * FREE SHIPPING — when freeAbovePoisha > 0 and the items subtotal
 * reaches it, the delivery charge (base + weight surcharge) becomes 0
 * and freeShippingApplied is true. Pickup never reports free shipping
 * (it is not a waived delivery). The COD fee is NOT part of the
 * delivery charge: codFeePoisha is returned verbatim from the rates in
 * every zone, and the CALLER adds it only for COD orders.
 *
 * All money is integer poisha. Nothing here throws: malformed slab
 * data degrades to "no slabs".
 */

export type ShippingZone = "inside_dhaka" | "outside_dhaka" | "pickup";

export interface WeightSlab {
  upToGrams: number;
  addPoisha: number;
}

export interface ShippingRates {
  insideDhakaPoisha: number;
  outsideDhakaPoisha: number;
  pickupPoisha: number;
  /** Subtotal at/above which delivery is free. 0 = free shipping off. */
  freeAbovePoisha: number;
  /** Flat COD handling fee (poisha); the caller adds it for COD only. */
  codFeePoisha: number;
  weightSlabs: WeightSlab[];
}

/** The pre-O2 hardcoded charges, kept as the built-in defaults. */
export const DEFAULT_SHIPPING_RATES: ShippingRates = {
  insideDhakaPoisha: 6000, // ৳60
  outsideDhakaPoisha: 12000, // ৳120
  pickupPoisha: 0,
  freeAbovePoisha: 0,
  codFeePoisha: 0,
  weightSlabs: [],
};

export interface ShippingCalcInput {
  /** Canonical district name (dataset nameEn, e.g. "Dhaka"). */
  district?: string;
  /** Explicit zone — wins over district derivation (staff flows). */
  zone?: ShippingZone;
  /** The checkout shippingMethod enum value; "pickup" forces pickup. */
  shippingMethod: ShippingZone;
  totalWeightGrams: number;
  subtotalPoisha: number;
}

export interface ShippingCalculation {
  /** Final delivery charge (base + weight surcharge, or 0 when free). */
  shippingPoisha: number;
  /** Configured COD fee, verbatim — caller adds it for COD only. */
  codFeePoisha: number;
  zone: ShippingZone;
  freeShippingApplied: boolean;
  /** Slab surcharge INCLUDED in shippingPoisha (0 when waived/free). */
  weightSurchargePoisha: number;
}

/**
 * Normalised spellings of the Dhaka district. Zone derivation only
 * needs this one district answered, so the alias set is deliberately
 * tiny and explicit instead of pulling the 700 KB geo dataset into
 * every consumer of this module. The checkout cascade stores the
 * canonical dataset name ("Dhaka"), so these aliases only matter for
 * API-direct callers and legacy free-text addresses.
 */
const DHAKA_DISTRICT_KEYS: ReadonlySet<string> = new Set([
  "dhaka",
  "ঢাকা", // canonical Bangla name
  "dacca", // common legacy spelling
]);

export function zoneForDistrict(district: string): "inside_dhaka" | "outside_dhaka" {
  const key = district.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
  return DHAKA_DISTRICT_KEYS.has(key) ? "inside_dhaka" : "outside_dhaka";
}

/**
 * Parse the `shipping.weight_slabs` setting: accepts the raw JSON
 * string or an already-parsed array. Entries need a finite
 * upToGrams > 0 and a finite addPoisha >= 0; anything else is dropped.
 * Result is sorted ascending by upToGrams, de-duplicated on upToGrams
 * (a later entry wins). Invalid input -> [] (no weight component).
 */
export function parseWeightSlabs(raw: unknown): WeightSlab[] {
  let value: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return [];
    try {
      value = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const byUpTo = new Map<number, number>();
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const upTo = (entry as { upToGrams?: unknown }).upToGrams;
    const add = (entry as { addPoisha?: unknown }).addPoisha;
    if (typeof upTo !== "number" || !Number.isFinite(upTo) || upTo <= 0) continue;
    if (typeof add !== "number" || !Number.isFinite(add) || add < 0) continue;
    byUpTo.set(Math.floor(upTo), Math.floor(add));
  }
  return [...byUpTo.entries()]
    .map(([upToGrams, addPoisha]) => ({ upToGrams, addPoisha }))
    .sort((a, b) => a.upToGrams - b.upToGrams);
}

/** Weight surcharge for a total weight — semantics in the file header. */
export function calculateWeightSurchargePoisha(
  slabs: readonly WeightSlab[],
  totalWeightGrams: number,
): number {
  if (slabs.length === 0 || totalWeightGrams <= 0) return 0;
  const base = slabs[0] as WeightSlab;
  if (totalWeightGrams <= base.upToGrams) return 0;

  let surcharge = 0;
  let remaining = totalWeightGrams - base.upToGrams;
  let prevUpTo = base.upToGrams;
  for (let i = 1; i < slabs.length && remaining > 0; i++) {
    const slab = slabs[i] as WeightSlab;
    const width = slab.upToGrams - prevUpTo;
    if (width <= 0) continue;
    // Entering this band at all charges it in full ("started slab").
    surcharge += slab.addPoisha;
    remaining -= Math.min(remaining, width);
    prevUpTo = slab.upToGrams;
  }
  if (remaining > 0) {
    const last = slabs[slabs.length - 1] as WeightSlab;
    const lastWidth =
      slabs.length > 1 ? last.upToGrams - (slabs[slabs.length - 2] as WeightSlab).upToGrams : last.upToGrams;
    if (lastWidth > 0) {
      surcharge += Math.ceil(remaining / lastWidth) * last.addPoisha;
    }
  }
  return surcharge;
}

/** Pure shipping calculation — the single implementation every flow runs. */
export function calculateShipping(
  rates: ShippingRates,
  input: ShippingCalcInput,
): ShippingCalculation {
  const zone: ShippingZone =
    input.shippingMethod === "pickup" || input.zone === "pickup"
      ? "pickup"
      : (input.zone ?? zoneForDistrict(input.district ?? ""));

  if (zone === "pickup") {
    return {
      shippingPoisha: rates.pickupPoisha,
      codFeePoisha: rates.codFeePoisha,
      zone,
      freeShippingApplied: false,
      weightSurchargePoisha: 0,
    };
  }

  const basePoisha = zone === "inside_dhaka" ? rates.insideDhakaPoisha : rates.outsideDhakaPoisha;
  const surcharge = calculateWeightSurchargePoisha(rates.weightSlabs, input.totalWeightGrams);

  if (rates.freeAbovePoisha > 0 && input.subtotalPoisha >= rates.freeAbovePoisha) {
    return {
      shippingPoisha: 0,
      codFeePoisha: rates.codFeePoisha,
      zone,
      freeShippingApplied: true,
      weightSurchargePoisha: 0,
    };
  }

  return {
    shippingPoisha: basePoisha + surcharge,
    codFeePoisha: rates.codFeePoisha,
    zone,
    freeShippingApplied: false,
    weightSurchargePoisha: surcharge,
  };
}
