/**
 * Shipping engine — SERVER entry (doc 17 batch O2).
 *
 * computeOrderShipping() is the contract the public orders route (and
 * any future create flow) calls: it loads the live rates from Settings
 * and runs the pure math in ./shipping-core.ts — the same math the
 * checkout page previews with. Zone is derived from the district;
 * see shipping-core.ts for the zone rule and the exact weight-slab
 * semantics.
 *
 * Settings keys (registered in src/lib/settings.ts SETTING_DEFAULTS;
 * every read falls back to the built-in default on error, following
 * the media-server pattern, so a settings outage can never break
 * checkout — it just charges the default rates):
 *   shipping.inside_dhaka_poisha   default "6000"   (৳60)
 *   shipping.outside_dhaka_poisha  default "12000"  (৳120)
 *   shipping.pickup_poisha         default "0"
 *   shipping.free_above_poisha     default "0" = free shipping OFF;
 *                                  subtotal >= value -> delivery free
 *   shipping.cod_fee_poisha        default "0"; returned verbatim,
 *                                  the caller adds it for COD only
 *   shipping.weight_slabs          default "" = no weight component;
 *                                  JSON [{ upToGrams, addPoisha }]
 *
 * getSetting() itself caches (5 min, invalidated on setSetting), so
 * rates are as fresh as every other settings consumer's.
 */
import { getSetting } from "../lib/settings";
import {
  calculateShipping,
  DEFAULT_SHIPPING_RATES,
  parseWeightSlabs,
  type ShippingCalculation,
  type ShippingRates,
  type ShippingZone,
} from "./shipping-core";

export * from "./shipping-core";

const KEY = {
  insideDhaka: "shipping.inside_dhaka_poisha",
  outsideDhaka: "shipping.outside_dhaka_poisha",
  pickup: "shipping.pickup_poisha",
  freeAbove: "shipping.free_above_poisha",
  codFee: "shipping.cod_fee_poisha",
  weightSlabs: "shipping.weight_slabs",
} as const;

function parsePoisha(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

async function readSetting(key: string): Promise<string | null> {
  return getSetting(key).catch(() => null);
}

/** Live shipping rates from Settings, with built-in defaults. */
export async function loadShippingRates(): Promise<ShippingRates> {
  const [inside, outside, pickup, freeAbove, codFee, slabsRaw] = await Promise.all([
    readSetting(KEY.insideDhaka),
    readSetting(KEY.outsideDhaka),
    readSetting(KEY.pickup),
    readSetting(KEY.freeAbove),
    readSetting(KEY.codFee),
    readSetting(KEY.weightSlabs),
  ]);
  return {
    insideDhakaPoisha: parsePoisha(inside, DEFAULT_SHIPPING_RATES.insideDhakaPoisha),
    outsideDhakaPoisha: parsePoisha(outside, DEFAULT_SHIPPING_RATES.outsideDhakaPoisha),
    pickupPoisha: parsePoisha(pickup, DEFAULT_SHIPPING_RATES.pickupPoisha),
    freeAbovePoisha: parsePoisha(freeAbove, DEFAULT_SHIPPING_RATES.freeAbovePoisha),
    codFeePoisha: parsePoisha(codFee, DEFAULT_SHIPPING_RATES.codFeePoisha),
    weightSlabs: parseWeightSlabs(slabsRaw),
  };
}

export interface ComputeOrderShippingInput {
  /** Canonical district name — the zone is derived from it. */
  district: string;
  shippingMethod: ShippingZone;
  totalWeightGrams: number;
  subtotalPoisha: number;
}

export type ComputeOrderShippingResult = ShippingCalculation;

/**
 * THE contract: price one order's delivery from the live Settings
 * rates. Never throws.
 */
export async function computeOrderShipping(
  input: ComputeOrderShippingInput,
): Promise<ComputeOrderShippingResult> {
  const rates = await loadShippingRates();
  return calculateShipping(rates, {
    district: input.district,
    shippingMethod: input.shippingMethod,
    totalWeightGrams: input.totalWeightGrams,
    subtotalPoisha: input.subtotalPoisha,
  });
}
