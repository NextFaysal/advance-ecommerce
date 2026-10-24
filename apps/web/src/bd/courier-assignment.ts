/**
 * Auto courier assignment — Agent 51 (BD differentiator, spec Part E).
 * Pure, deterministic assignment engine: NO courier API call, NO
 * persistence, inputs are never mutated. Given an order's facts and a
 * per-courier stats table it returns a ranked list with a full per-rule
 * trace, so a staff member can always see WHY a courier was chosen —
 * and a manual override records the engine's recommendation alongside
 * the staff pick instead of silently replacing it.
 *
 * Rules, in priority order:
 *   1. HARD FILTERS (a failing courier is excluded, never scored):
 *      inactive -> zone unsupported -> overweight -> COD unsupported
 *      (only when the order actually carries COD money).
 *   2. SCORING (eligible couriers only), a weighted average of 0..1
 *      components, normalised over the components that are available
 *      for that courier, then scaled to an integer 0..100:
 *        delivery  weight 40 — delivery rate from src/analytics
 *                              scoreCourier()'s deliveryRateBps.
 *        returns   weight 20 — (1 - return rate), scoreCourier()'s
 *                              returnRateBps.
 *        charge    weight 20 — cheapest eligible charge / this charge.
 *                              The charge itself is the REAL sandbox
 *                              courierChargePoisha(zone, weightGrams).
 *        eta       weight 10 — fastest eligible ETA / this ETA
 *                              (stats estimatedDays; the sample table's
 *                              values mirror sandbox getRates()).
 *        district  weight 10 — this district's past success rate for
 *                              the courier, when district stats exist.
 *        care      weight 10 — (1 - return rate) again, ONLY when the
 *                              order is fragile or high-value: delicate
 *                              / expensive parcels should ride with the
 *                              courier that brings the fewest back.
 *      scoreCourier()'s own 0..100 total is deliberately NOT reused:
 *      it blends a COD-collection component (25%) that assignment
 *      inputs do not carry, so only its delivery/return basis points
 *      are taken and the weighting above is this engine's own.
 *   3. TIE-BREAK (total order, fully deterministic): higher score,
 *      then lower charge, then provider key A->Z. No Date, no random,
 *      no input-order dependence.
 *
 * Money is integer poisha everywhere; rates are basis points.
 * Test case (verified by smoke test): inside-Dhaka order, 800 g,
 * COD 150000 poisha, sample stats -> Steadfast chosen (best delivery
 * rate 9400 bps, joint-cheapest charge 6000 poisha from the real
 * courierChargePoisha); eCourier excluded as inactive; a 6000 g order
 * excludes Pathao (max 5000 g); a prepaid order (COD 0) never triggers
 * the COD filter.
 */
import { z } from "zod";
import type { CourierProviderName, ShippingZone } from "../integrations/courier";
import { courierChargePoisha, createSandboxCourierProvider, SANDBOX_COURIER_PROVIDERS } from "../integrations/sandbox/courier-provider";
import { scoreCourier, type CourierStats } from "../analytics/performance";

export type { ShippingZone };

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export interface CourierAssignmentOrderFacts {
  orderId: string | null;
  /** District name as printed on the order, e.g. "Dhaka", "Chattogram". */
  district: string;
  zone: ShippingZone;
  weightGrams: number;
  /** Integer poisha to collect on delivery. 0 = prepaid. */
  codAmountPoisha: number;
  fragile: boolean;
  highValue: boolean;
}

export interface CourierDistrictStat {
  delivered: number;
  total: number;
}

export interface CourierAssignmentStats {
  /** Provider key, e.g. "steadfast". Free string so a new courier can
   *  be scored before it gets a sandbox adapter. */
  provider: string;
  active: boolean;
  supportedZones: ShippingZone[];
  maxWeightGrams: number;
  codSupported: boolean;
  delivered: number;
  failed: number;
  returned: number;
  /** Historical average delivery time; display/context only. */
  avgDeliveryDays: number | null;
  /** Promised ETA in days (mirrors the provider's getRates() ETA). */
  estimatedDays: number | null;
  /** Optional per-district history, keyed by district name. */
  districtStats?: Record<string, CourierDistrictStat>;
}

export const courierAssignmentOrderSchema = z.object({
  orderId: z.string().min(1).nullable().default(null),
  district: z.string().min(1),
  zone: z.enum(["inside_dhaka", "outside_dhaka", "district"]),
  weightGrams: z.number().int().positive(),
  codAmountPoisha: z.number().int().nonnegative(),
  fragile: z.boolean().default(false),
  highValue: z.boolean().default(false),
});

export const courierAssignmentStatsSchema = z.object({
  provider: z.string().min(1),
  active: z.boolean(),
  supportedZones: z.array(z.enum(["inside_dhaka", "outside_dhaka", "district"])).min(1),
  maxWeightGrams: z.number().int().positive(),
  codSupported: z.boolean(),
  delivered: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  avgDeliveryDays: z.number().nonnegative().nullable(),
  estimatedDays: z.number().int().positive().nullable(),
  districtStats: z
    .record(z.string(), z.object({ delivered: z.number().int().nonnegative(), total: z.number().int().nonnegative() }))
    .optional(),
});

export const courierAssignmentRequestSchema = z.object({
  order: courierAssignmentOrderSchema,
  /** Optional stats override; omitted -> SAMPLE_COURIER_STATS (demo). */
  stats: z.array(courierAssignmentStatsSchema).min(1).optional(),
});

export type CourierAssignmentRequest = z.infer<typeof courierAssignmentRequestSchema>;

/* ------------------------------------------------------------------ */
/* Zone classification                                                 */
/* ------------------------------------------------------------------ */

/**
 * District -> shipping zone, following the platform's ShippingZone
 * taxonomy (src/integrations/courier.ts). Only Dhaka district itself
 * is "inside_dhaka"; every other district defaults to "outside_dhaka".
 * The "district" zone (district-town rate on some couriers' rate
 * cards) is never guessed from a district name — a caller that knows
 * the delivery point is the district sadar passes zone: "district"
 * explicitly in the order facts.
 */
export function zoneForDistrict(district: string): ShippingZone {
  return district.trim().toLowerCase() === "dhaka" ? "inside_dhaka" : "outside_dhaka";
}

/* ------------------------------------------------------------------ */
/* Trace + output                                                      */
/* ------------------------------------------------------------------ */

/** One entry per rule evaluation, mirroring the automation engine's
 *  per-leaf trace style (rule, matched, expected/actual when known). */
export interface AssignmentTraceEntry {
  step: "hard_filter" | "score" | "decision";
  rule: string;
  provider: string | null;
  matched: boolean;
  expected?: string | number;
  actual?: string | number;
  messageBn: string;
  messageEn: string;
}

export type CourierExclusionCode = "inactive" | "zone_unsupported" | "overweight" | "cod_unsupported";

export interface ScoreComponent {
  key: "delivery" | "returns" | "charge" | "eta" | "district" | "care";
  weight: number;
  /** 0..10000 basis points of the component value; null = unavailable
   *  for this courier, so the component is left out of its average. */
  valueBps: number | null;
  included: boolean;
}

export interface RankedCourier {
  provider: string;
  eligible: boolean;
  exclusionCodes: CourierExclusionCode[];
  exclusionReasonsBn: string[];
  exclusionReasonsEn: string[];
  /** Real sandbox charge for this order; null when excluded. */
  chargePoisha: number | null;
  estimatedDays: number | null;
  deliveryRateBps: number | null;
  returnRateBps: number | null;
  /** Integer 0..100; null when excluded. */
  score: number | null;
  components: ScoreComponent[];
  reasonsBn: string[];
  reasonsEn: string[];
}

export interface CourierAssignmentResult {
  order: CourierAssignmentOrderFacts;
  /** The engine's pick (ranked[0]); null when nobody is eligible. */
  chosen: RankedCourier | null;
  /** Eligible couriers, best first (deterministic order). */
  ranked: RankedCourier[];
  /** Excluded couriers, in input order, each with its filter reasons. */
  excluded: RankedCourier[];
  reasonsBn: string[];
  reasonsEn: string[];
  trace: AssignmentTraceEntry[];
}

/* ------------------------------------------------------------------ */
/* Sample stats — TEMPORARY DEMO                                       */
/* ------------------------------------------------------------------ */

/**
 * TEMPORARY DEMO stats table. The numbers are plausible samples, NOT
 * measured courier performance — when real shipment history exists in
 * the DB, the caller builds CourierAssignmentStats from it (the same
 * counts src/analytics scoreCourier() consumes) and passes them in.
 * estimatedDays for the three sandbox providers mirror their real
 * sandbox getRates() ETAs (steadfast 2, pathao 2, redx 3).
 */
export const SAMPLE_COURIER_STATS: CourierAssignmentStats[] = [
  {
    provider: "steadfast",
    active: true,
    supportedZones: ["inside_dhaka", "outside_dhaka", "district"],
    maxWeightGrams: 10000,
    codSupported: true,
    delivered: 940,
    failed: 25,
    returned: 35,
    avgDeliveryDays: 1.8,
    estimatedDays: 2,
    districtStats: {
      Dhaka: { delivered: 480, total: 500 },
      Chattogram: { delivered: 172, total: 190 },
    },
  },
  {
    provider: "pathao",
    active: true,
    supportedZones: ["inside_dhaka", "outside_dhaka", "district"],
    maxWeightGrams: 5000,
    codSupported: true,
    delivered: 905,
    failed: 40,
    returned: 55,
    avgDeliveryDays: 2.1,
    estimatedDays: 2,
    districtStats: {
      Dhaka: { delivered: 455, total: 500 },
      Chattogram: { delivered: 160, total: 185 },
    },
  },
  {
    provider: "redx",
    active: true,
    supportedZones: ["inside_dhaka", "outside_dhaka", "district"],
    maxWeightGrams: 15000,
    codSupported: true,
    delivered: 880,
    failed: 45,
    returned: 75,
    avgDeliveryDays: 2.6,
    estimatedDays: 3,
    districtStats: {
      Dhaka: { delivered: 430, total: 495 },
      Chattogram: { delivered: 150, total: 180 },
    },
  },
  {
    provider: "paperfly",
    active: true,
    supportedZones: ["inside_dhaka", "district"],
    maxWeightGrams: 3000,
    codSupported: true,
    delivered: 820,
    failed: 60,
    returned: 120,
    avgDeliveryDays: 3.1,
    estimatedDays: 3,
  },
  {
    provider: "ecourier",
    active: false,
    supportedZones: ["inside_dhaka", "outside_dhaka", "district"],
    maxWeightGrams: 10000,
    codSupported: true,
    delivered: 860,
    failed: 50,
    returned: 90,
    avgDeliveryDays: 2.9,
    estimatedDays: 3,
  },
];

export const SAMPLE_STATS_META = {
  source: "TEMPORARY_DEMO",
  noteBn: "নমুনা পরিসংখ্যান — আসল শিপমেন্ট ইতিহাস থেকে নয়। DB-তে ইতিহাস এলে এই টেবিল বদলে সেটাই ব্যবহৃত হবে।",
  noteEn: "Sample statistics — not measured shipment history. Replaced by DB history when available.",
} as const;

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

const WEIGHTS = { delivery: 40, returns: 20, charge: 20, eta: 10, district: 10, care: 10 } as const;

function ratesFor(stats: CourierAssignmentStats): { deliveryRateBps: number; returnRateBps: number } {
  // Reuse the analytics courier score's rate math (identical inputs:
  // delivered/failed/returned counts). Its COD-collection fields are
  // not assignment inputs, so they are passed as 0/0 — scoreCourier
  // then reports codCollectionBps 10000, which this engine ignores;
  // only the delivery/return basis points are consumed.
  const asCourierStats: CourierStats = {
    provider: stats.provider,
    shipments: stats.delivered + stats.failed + stats.returned,
    delivered: stats.delivered,
    failed: stats.failed,
    returned: stats.returned,
    avgDeliveryHours: stats.avgDeliveryDays === null ? null : Math.round(stats.avgDeliveryDays * 24),
    codCollectedPoisha: 0,
    codExpectedPoisha: 0,
  };
  const scored = scoreCourier(asCourierStats);
  return { deliveryRateBps: scored.deliveryRateBps, returnRateBps: scored.returnRateBps };
}

interface EligibleWork {
  stats: CourierAssignmentStats;
  chargePoisha: number;
  deliveryRateBps: number;
  returnRateBps: number;
  districtBps: number | null;
}

export function assignCourier(
  order: CourierAssignmentOrderFacts,
  statsList: readonly CourierAssignmentStats[],
): CourierAssignmentResult {
  const trace: AssignmentTraceEntry[] = [];
  const excluded: RankedCourier[] = [];
  const work: EligibleWork[] = [];

  /* ---- Step 1: hard filters, in the documented priority order ---- */
  for (const stats of statsList) {
    const codes: CourierExclusionCode[] = [];
    const reasonsBn: string[] = [];
    const reasonsEn: string[] = [];
    const fail = (
      rule: string,
      code: CourierExclusionCode,
      bn: string,
      en: string,
      expected?: string | number,
      actual?: string | number,
    ) => {
      codes.push(code);
      reasonsBn.push(bn);
      reasonsEn.push(en);
      const entry: AssignmentTraceEntry = {
        step: "hard_filter",
        rule,
        provider: stats.provider,
        matched: false,
        messageBn: bn,
        messageEn: en,
      };
      if (expected !== undefined) entry.expected = expected;
      if (actual !== undefined) entry.actual = actual;
      trace.push(entry);
    };

    if (!stats.active) {
      fail("active", "inactive", `${stats.provider}: নিষ্ক্রিয় — বর্তমানে বুকিং নেওয়া হচ্ছে না।`, `${stats.provider}: inactive — not currently accepting bookings.`);
    } else if (!stats.supportedZones.includes(order.zone)) {
      fail(
        "zone_supported",
        "zone_unsupported",
        `${stats.provider}: এই জোনে (${order.zone}) ডেলিভারি করে না।`,
        `${stats.provider}: does not deliver to zone ${order.zone}.`,
        order.zone,
        stats.supportedZones.join(","),
      );
    } else if (order.weightGrams > stats.maxWeightGrams) {
      fail(
        "max_weight",
        "overweight",
        `${stats.provider}: ওজনসীমা ${stats.maxWeightGrams} গ্রাম, অর্ডারের ওজন ${order.weightGrams} গ্রাম।`,
        `${stats.provider}: weight limit ${stats.maxWeightGrams} g, order weighs ${order.weightGrams} g.`,
        stats.maxWeightGrams,
        order.weightGrams,
      );
    } else if (order.codAmountPoisha > 0 && !stats.codSupported) {
      fail(
        "cod_supported",
        "cod_unsupported",
        `${stats.provider}: COD অর্ডার (${order.codAmountPoisha} পয়সা) নেয় না।`,
        `${stats.provider}: does not accept COD orders (${order.codAmountPoisha} poisha).`,
        "cod_supported",
        "cod_unsupported",
      );
    }

    if (codes.length > 0) {
      excluded.push({
        provider: stats.provider,
        eligible: false,
        exclusionCodes: codes,
        exclusionReasonsBn: reasonsBn,
        exclusionReasonsEn: reasonsEn,
        chargePoisha: null,
        estimatedDays: stats.estimatedDays,
        deliveryRateBps: null,
        returnRateBps: null,
        score: null,
        components: [],
        reasonsBn: reasonsBn,
        reasonsEn: reasonsEn,
      });
      continue;
    }

    trace.push({
      step: "hard_filter",
      rule: "all_filters",
      provider: stats.provider,
      matched: true,
      messageBn: `${stats.provider}: সব হার্ড ফিল্টার পাস করেছে।`,
      messageEn: `${stats.provider}: passed all hard filters.`,
    });

    const rates = ratesFor(stats);
    const districtStat = stats.districtStats?.[order.district];
    const districtBps =
      districtStat && districtStat.total > 0
        ? Math.round((districtStat.delivered / districtStat.total) * 10000)
        : null;
    work.push({
      stats,
      chargePoisha: courierChargePoisha(order.zone, order.weightGrams),
      deliveryRateBps: rates.deliveryRateBps,
      returnRateBps: rates.returnRateBps,
      districtBps,
    });
  }

  /* ---- Step 2: scoring ------------------------------------------- */
  const cheapestCharge = work.length > 0 ? Math.min(...work.map((w) => w.chargePoisha)) : null;
  const knownEtas = work.map((w) => w.stats.estimatedDays).filter((d): d is number => d !== null);
  const fastestEta = knownEtas.length > 0 ? Math.min(...knownEtas) : null;
  const careApplies = order.fragile || order.highValue;

  const ranked: RankedCourier[] = work.map((w) => {
    const components: ScoreComponent[] = [];
    const add = (key: ScoreComponent["key"], valueBps: number | null) => {
      components.push({ key, weight: WEIGHTS[key], valueBps, included: valueBps !== null });
    };
    add("delivery", w.deliveryRateBps);
    add("returns", 10000 - w.returnRateBps);
    add("charge", w.chargePoisha > 0 && cheapestCharge !== null ? Math.round((cheapestCharge / w.chargePoisha) * 10000) : 10000);
    add("eta", w.stats.estimatedDays !== null && fastestEta !== null ? Math.round((fastestEta / w.stats.estimatedDays) * 10000) : null);
    add("district", w.districtBps);
    if (careApplies) add("care", 10000 - w.returnRateBps);

    let weightedSum = 0;
    let weightTotal = 0;
    for (const c of components) {
      if (!c.included || c.valueBps === null) continue;
      weightedSum += c.weight * c.valueBps;
      weightTotal += c.weight;
    }
    const score = weightTotal > 0 ? Math.round(weightedSum / weightTotal / 100) : 0;

    trace.push({
      step: "score",
      rule: "weighted_score",
      provider: w.stats.provider,
      matched: true,
      actual: score,
      messageBn: `${w.stats.provider}: স্কোর ${score}/১০০ (ডেলিভারি হার ${(w.deliveryRateBps / 100).toFixed(1)}%, রিটার্ন হার ${(w.returnRateBps / 100).toFixed(1)}%, চার্জ ${w.chargePoisha} পয়সা)।`,
      messageEn: `${w.stats.provider}: score ${score}/100 (delivery rate ${(w.deliveryRateBps / 100).toFixed(1)}%, return rate ${(w.returnRateBps / 100).toFixed(1)}%, charge ${w.chargePoisha} poisha).`,
    });

    return {
      provider: w.stats.provider,
      eligible: true,
      exclusionCodes: [],
      exclusionReasonsBn: [],
      exclusionReasonsEn: [],
      chargePoisha: w.chargePoisha,
      estimatedDays: w.stats.estimatedDays,
      deliveryRateBps: w.deliveryRateBps,
      returnRateBps: w.returnRateBps,
      score,
      components,
      reasonsBn: [],
      reasonsEn: [],
    };
  });

  /* ---- Step 3: deterministic ordering ----------------------------- */
  ranked.sort((a, b) => {
    const byScore = (b.score ?? 0) - (a.score ?? 0);
    if (byScore !== 0) return byScore;
    const byCharge = (a.chargePoisha ?? 0) - (b.chargePoisha ?? 0);
    if (byCharge !== 0) return byCharge;
    return a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0;
  });

  /* ---- Reasons (relative to the eligible field) -------------------- */
  const bestDeliveryBps = ranked.length > 0 ? Math.max(...ranked.map((r) => r.deliveryRateBps ?? 0)) : null;
  const lowestReturnBps = ranked.length > 0 ? Math.min(...ranked.map((r) => r.returnRateBps ?? 10000)) : null;
  for (const r of ranked) {
    const bn: string[] = [];
    const en: string[] = [];
    if (bestDeliveryBps !== null && r.deliveryRateBps === bestDeliveryBps) {
      bn.push(`সর্বোচ্চ ডেলিভারি সাফল্যের হার (${((r.deliveryRateBps ?? 0) / 100).toFixed(1)}%)`);
      en.push(`highest delivery success rate (${((r.deliveryRateBps ?? 0) / 100).toFixed(1)}%)`);
    }
    if (lowestReturnBps !== null && r.returnRateBps === lowestReturnBps) {
      bn.push(`সর্বনিম্ন রিটার্ন হার (${((r.returnRateBps ?? 0) / 100).toFixed(1)}%)`);
      en.push(`lowest return rate (${((r.returnRateBps ?? 0) / 100).toFixed(1)}%)`);
    }
    if (cheapestCharge !== null && r.chargePoisha === cheapestCharge) {
      bn.push(`সবচেয়ে কম চার্জ (${r.chargePoisha} পয়সা)`);
      en.push(`cheapest charge (${r.chargePoisha} poisha)`);
    }
    if (fastestEta !== null && r.estimatedDays === fastestEta) {
      bn.push(`দ্রুততম ETA (${r.estimatedDays} দিন)`);
      en.push(`fastest ETA (${r.estimatedDays} days)`);
    }
    const districtComp = r.components.find((c) => c.key === "district");
    if (districtComp && districtComp.included && districtComp.valueBps !== null) {
      bn.push(`${order.district} জেলায় আগের সাফল্য ${((districtComp.valueBps) / 100).toFixed(1)}%`);
      en.push(`${((districtComp.valueBps) / 100).toFixed(1)}% past success in ${order.district} district`);
    }
    if (bn.length === 0) {
      bn.push(`সম্মিলিত স্কোর ${r.score}/১০০`);
      en.push(`combined score ${r.score}/100`);
    }
    r.reasonsBn = bn;
    r.reasonsEn = en;
  }

  const chosen = ranked[0] ?? null;
  trace.push({
    step: "decision",
    rule: "choose_top_ranked",
    provider: chosen?.provider ?? null,
    matched: chosen !== null,
    messageBn: chosen
      ? `নির্বাচিত: ${chosen.provider} (স্কোর ${chosen.score}/১০০)।`
      : "কোনো কুরিয়ার যোগ্য নয় — সবাই হার্ড ফিল্টারে বাদ পড়েছে। স্টাফকে ম্যানুয়ালি সিদ্ধান্ত নিতে হবে।",
    messageEn: chosen
      ? `Chosen: ${chosen.provider} (score ${chosen.score}/100).`
      : "No courier is eligible — every provider failed a hard filter. Staff must decide manually.",
  });

  return {
    order,
    chosen,
    ranked,
    excluded,
    reasonsBn: chosen ? chosen.reasonsBn : [],
    reasonsEn: chosen ? chosen.reasonsEn : [],
    trace,
  };
}

/* ------------------------------------------------------------------ */
/* Sandbox rate cross-check helper                                     */
/* ------------------------------------------------------------------ */

/**
 * The REAL sandbox rates (charge + ETA) straight from each sandbox
 * provider's getRates() — for callers/tests that want to verify the
 * sample stats table's estimatedDays and the engine's charges against
 * the sandbox source instead of trusting the copies.
 */
export async function getSandboxRates(
  zone: ShippingZone,
  weightGrams: number,
): Promise<Array<{ provider: string; chargePoisha: number; estimatedDays: number | null }>> {
  const out: Array<{ provider: string; chargePoisha: number; estimatedDays: number | null }> = [];
  for (const name of SANDBOX_COURIER_PROVIDERS) {
    const rates = await createSandboxCourierProvider(name).getRates({
      zone,
      district: "",
      weightGrams,
      orderValuePoisha: 0,
    });
    for (const rate of rates) {
      out.push({ provider: rate.provider, chargePoisha: rate.chargePoisha, estimatedDays: rate.estimatedDays });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Manual override (types + pure decision builder)                     */
/* ------------------------------------------------------------------ */

/**
 * A booking decision. The engine's recommendation is ALWAYS recorded;
 * when staff pick a different courier the decision says so, with the
 * staff reason — the recommendation is never overwritten or hidden.
 */
export interface CourierAssignmentDecision {
  orderId: string | null;
  recommendedProvider: string | null;
  chosenProvider: string;
  source: "engine" | "manual_override";
  /** Required (non-empty) when source is "manual_override". */
  overrideReason: string | null;
  decidedBy: string | null;
  /** ISO timestamp, supplied by the caller (this module never reads
   *  the clock, keeping every function pure/deterministic). */
  decidedAt: string;
}

export type ApplyOverrideResult =
  | { ok: true; decision: CourierAssignmentDecision }
  | { ok: false; error: string };

export function buildEngineDecision(
  result: CourierAssignmentResult,
  decidedBy: string | null,
  decidedAt: string,
): ApplyOverrideResult {
  if (!result.chosen) {
    return { ok: false, error: "Engine has no recommendation — no courier is eligible for this order." };
  }
  return {
    ok: true,
    decision: {
      orderId: result.order.orderId,
      recommendedProvider: result.chosen.provider,
      chosenProvider: result.chosen.provider,
      source: "engine",
      overrideReason: null,
      decidedBy,
      decidedAt,
    },
  };
}

export function applyManualOverride(
  result: CourierAssignmentResult,
  chosenProvider: CourierProviderName | string,
  overrideReason: string,
  decidedBy: string,
  decidedAt: string,
): ApplyOverrideResult {
  const reason = overrideReason.trim();
  if (!reason) return { ok: false, error: "A reason is required for a manual override." };
  if (!decidedBy.trim()) return { ok: false, error: "decidedBy is required for a manual override." };
  return {
    ok: true,
    decision: {
      orderId: result.order.orderId,
      recommendedProvider: result.chosen?.provider ?? null,
      chosenProvider,
      source: "manual_override",
      overrideReason: reason,
      decidedBy,
      decidedAt,
    },
  };
}
