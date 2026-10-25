/**
 * Landed-cost calculator (Wave 15-3, doc 16 §P7) — pure math, no I/O.
 *
 * A BD merchant importing from China buys in USD/CNY, pays
 * international shipping, customs duty and local transport, and needs
 * ONE number: what does each unit actually cost me, in taka, once it
 * reaches my shelf? That per-unit landed cost is what belongs in a
 * variant's costPoisha.
 *
 * Inputs are decimal STRINGS (merchant-typed). Every decimal is parsed
 * to integer hundredths by exact string math (`takaStringToPoisha` —
 * half-up at the third decimal, no float multiplication), then all
 * arithmetic is integer poisha:
 *
 *   goodsPerUnit    = round(unitForeignCents × ratePoisha / 100)
 *   shippingTotal   = round(shippingForeignCents × ratePoisha / 100)
 *   shippingPerUnit = round(shippingTotal / quantity)
 *   cifPerUnit      = goodsPerUnit + shippingPerUnit
 *   dutyPerUnit     = round(cifPerUnit × dutyBps / 10000)   // on CIF
 *   localPerUnit    = round(localTransportPoisha / quantity)
 *   landedPerUnit   = cifPerUnit + dutyPerUnit + localPerUnit
 *
 * Rounding: round-half-up at each step (values are non-negative, so
 * Math.round on the exact integer ratio is half-up here). Each step
 * rounds to whole poisha because a ledger cannot hold fractions —
 * the total may differ from a float computation by a poisha or two,
 * which is the honest price of integer money.
 *
 * Suggested sell prices use margin ON COST: sell = landed × (1 + m),
 * rounded half-up to whole poisha; profit = sell − landed.
 */
import { takaStringToPoisha } from "@/catalog/import";

export interface LandedInputs {
  /** Unit price in the foreign currency, decimal string ("12.50"). */
  unitPriceForeign: string;
  /** Merchant-entered rate: taka per 1 unit of foreign currency ("119.75"). */
  rateTaka: string;
  /** Units in the shipment (integer ≥ 1). */
  quantity: number;
  /** International shipping for the whole shipment, foreign currency. */
  shippingForeign: string;
  /** Customs duty percent ("25" or "12.5"). Applied to CIF. */
  dutyPercent: string;
  /** Local transport for the whole shipment, in TAKA. */
  localTransportTaka: string;
}

export interface LandedBreakdown {
  goodsPoishaPerUnit: number;
  shippingPoishaPerUnit: number;
  cifPoishaPerUnit: number;
  dutyPoishaPerUnit: number;
  localPoishaPerUnit: number;
  landedPoishaPerUnit: number;
  landedPoishaTotal: number;
}

export interface MarginRow {
  marginPercent: number;
  sellPoisha: number;
  profitPoisha: number;
}

export const MARGIN_STEPS = [10, 20, 30, 40, 50] as const;

/** mulDiv with round-half-up on non-negative integers. */
function mulDivRound(a: number, b: number, d: number): number {
  return Math.round((a * b) / d);
}

function divRound(a: number, d: number): number {
  return Math.round(a / d);
}

/** Parse a merchant decimal string to integer hundredths; null if invalid/negative. */
function parseHundredths(value: string): number | null {
  const v = value.trim();
  if (v === "" || v.startsWith("-")) return null;
  const parsed = takaStringToPoisha(v);
  return parsed === undefined ? null : parsed;
}

export type LandedResult =
  | { ok: true; breakdown: LandedBreakdown; margins: MarginRow[] }
  | { ok: false; field: keyof LandedInputs; messageBn: string };

export function computeLandedCost(inputs: LandedInputs): LandedResult {
  const unitCents = parseHundredths(inputs.unitPriceForeign);
  if (unitCents === null || unitCents <= 0) {
    return { ok: false, field: "unitPriceForeign", messageBn: "প্রতি পিসের দাম সঠিক সংখ্যায় লিখুন (যেমন 12.50)।" };
  }
  const ratePoisha = parseHundredths(inputs.rateTaka);
  if (ratePoisha === null || ratePoisha <= 0) {
    return { ok: false, field: "rateTaka", messageBn: "ডলার/ইউয়ানের আজকের ৳ রেট লিখুন (যেমন 119.75)।" };
  }
  if (!Number.isInteger(inputs.quantity) || inputs.quantity < 1) {
    return { ok: false, field: "quantity", messageBn: "মোট পিসের সংখ্যা অন্তত ১ হতে হবে।" };
  }
  const shippingCents = inputs.shippingForeign.trim() === "" ? 0 : parseHundredths(inputs.shippingForeign);
  if (shippingCents === null) {
    return { ok: false, field: "shippingForeign", messageBn: "আন্তর্জাতিক শিপিং খরচ সংখ্যায় লিখুন (না থাকলে 0)।" };
  }
  const dutyBps = inputs.dutyPercent.trim() === "" ? 0 : parseHundredths(inputs.dutyPercent);
  if (dutyBps === null) {
    return { ok: false, field: "dutyPercent", messageBn: "শুল্ক % সংখ্যায় লিখুন (যেমন 25)।" };
  }
  const localPoisha = inputs.localTransportTaka.trim() === "" ? 0 : parseHundredths(inputs.localTransportTaka);
  if (localPoisha === null) {
    return { ok: false, field: "localTransportTaka", messageBn: "স্থানীয় পরিবহন খরচ টাকায় লিখুন (না থাকলে 0)।" };
  }

  const goodsPoishaPerUnit = mulDivRound(unitCents, ratePoisha, 100);
  const shippingTotalPoisha = mulDivRound(shippingCents, ratePoisha, 100);
  const shippingPoishaPerUnit = divRound(shippingTotalPoisha, inputs.quantity);
  const cifPoishaPerUnit = goodsPoishaPerUnit + shippingPoishaPerUnit;
  const dutyPoishaPerUnit = mulDivRound(cifPoishaPerUnit, dutyBps, 10_000);
  const localPoishaPerUnit = divRound(localPoisha, inputs.quantity);
  const landedPoishaPerUnit = cifPoishaPerUnit + dutyPoishaPerUnit + localPoishaPerUnit;

  const breakdown: LandedBreakdown = {
    goodsPoishaPerUnit,
    shippingPoishaPerUnit,
    cifPoishaPerUnit,
    dutyPoishaPerUnit,
    localPoishaPerUnit,
    landedPoishaPerUnit,
    landedPoishaTotal: landedPoishaPerUnit * inputs.quantity,
  };
  const margins: MarginRow[] = MARGIN_STEPS.map((m) => {
    const sellPoisha = divRound(landedPoishaPerUnit * (100 + m), 100);
    return { marginPercent: m, sellPoisha, profitPoisha: sellPoisha - landedPoishaPerUnit };
  });
  return { ok: true, breakdown, margins };
}

/** Integer poisha → editable taka string ("1234.50"), for prefilling form fields. */
export function poishaToTakaInput(poisha: number): string {
  const taka = Math.trunc(poisha / 100);
  const rem = poisha % 100;
  return rem === 0 ? String(taka) : `${taka}.${String(rem).padStart(2, "0")}`;
}
