/**
 * Booking recommendation — ADV-5 (doc 22), closing doc 21 G3-14.
 *
 * Wires the pure assignment engine (src/bd/courier-assignment.ts) into
 * the order-workspace booking flow. Before this module the engine was
 * only exercised by the bd-tools demo panel; nothing in the booking
 * path ever called it.
 *
 * What happens here:
 *  - Order facts are built from the order's REAL rows: district (zone
 *    via the engine's own zoneForDistrict), the requested lines'
 *    variant weights and goods value, and the COD amount (the goods
 *    value of the requested lines on a COD order; 0 when prepaid —
 *    matching the engine's "money to collect on delivery" semantics).
 *  - Courier stats come from buildCourierStatsFromDb(): delivered /
 *    failed / returned counts and per-district rates aggregated from
 *    actual Shipment rows; capabilities (active, zones, max weight,
 *    ETA) from the provider catalogue. Stats are restricted to the
 *    providers a booking can actually be created for
 *    (SANDBOX_COURIER_PROVIDERS), so a recommendation is always
 *    actionable from this flow.
 *  - HONEST INSUFFICIENT-DATA RULE: when the shipment history carries
 *    ZERO terminal outcomes (no delivered/failed/returned rows at
 *    all), rates would be arithmetic on empty counts — the engine's
 *    returns component would even read a never-used courier as
 *    "0% returns". In that state this service returns
 *    status "insufficient_data" with NO ranked list and NO scores;
 *    the panel falls back to manual choice. Per-provider `hasHistory`
 *    flags ride along so a courier with no history of its own is
 *    labelled as such even when others have data.
 *  - fragile / highValue: the Order model carries no such flags, so
 *    both are false and the engine's "care" component simply does not
 *    apply. Nothing is inferred from the order total.
 *
 * Sandbox honesty: bookings remain sandbox bookings; the engine's
 * charge is the sandbox rate function and is shown in the panel as an
 * estimate (the booking itself recomputes its charge server-side).
 */
import { prisma } from "@advance-ecommerce/db";
import {
  assignCourier,
  zoneForDistrict,
  type CourierAssignmentOrderFacts,
  type CourierAssignmentResult,
  type CourierAssignmentStats,
  type RankedCourier,
} from "@/bd/courier-assignment";
import { buildCourierStatsFromDb } from "@/bd/courier-stats-db";
import { SANDBOX_COURIER_PROVIDERS } from "@/integrations/sandbox/courier-provider";

export interface RecommendationLineInput {
  orderItemId: string;
  quantity: number;
}

/** One order line as the facts builder needs it (already resolved). */
export interface FactsLine {
  orderItemId: string;
  quantity: number;
  unitPricePoisha: number;
  /** Variant product weight; null when the product carries none. */
  weightGrams: number | null;
}

/** Booking charge fallback the split-booking creator also uses when a
 *  parcel's lines carry no weight at all (1 kg placeholder). */
export const FALLBACK_WEIGHT_GRAMS = 1000;

/**
 * Pure facts builder (smoke-tested): order + resolved lines -> the
 * engine's order facts. Weight falls back to FALLBACK_WEIGHT_GRAMS
 * when every line is weightless, flagged via weightEstimated so the
 * UI can say the weight was assumed.
 */
export function buildBookingFacts(input: {
  orderId: string;
  district: string;
  paymentMethod: string;
  lines: FactsLine[];
}): { facts: CourierAssignmentOrderFacts; weightEstimated: boolean } {
  let weightGrams = 0;
  let goodsValuePoisha = 0;
  for (const line of input.lines) {
    weightGrams += (line.weightGrams ?? 0) * line.quantity;
    goodsValuePoisha += line.unitPricePoisha * line.quantity;
  }
  const weightEstimated = weightGrams <= 0;
  return {
    facts: {
      orderId: input.orderId,
      district: input.district,
      zone: zoneForDistrict(input.district),
      weightGrams: weightEstimated ? FALLBACK_WEIGHT_GRAMS : weightGrams,
      codAmountPoisha: input.paymentMethod === "COD" ? goodsValuePoisha : 0,
      fragile: false,
      highValue: false,
    },
    weightEstimated,
  };
}

export type RecommendationStatus = "ok" | "insufficient_data" | "no_eligible";

export interface RankedCourierView extends RankedCourier {
  /** True when this provider has at least one terminal shipment in
   *  the DB history (its rates are measured, not empty-count math). */
  hasHistory: boolean;
}

export interface BookingRecommendation {
  status: RecommendationStatus;
  facts: CourierAssignmentOrderFacts;
  weightEstimated: boolean;
  /** Terminal outcomes (delivered+failed+returned) across bookable
   *  providers — the history the ranking actually rests on. */
  historyShipments: number;
  /** All non-deleted shipments the stats were aggregated from. */
  shipmentCount: number;
  recommended: RankedCourierView | null;
  /** Best first. EMPTY when status is "insufficient_data" — scores
   *  over zero history are not shown, by design. */
  ranked: RankedCourierView[];
  /** Capability exclusions (facts, not scores — shown in every state). */
  excluded: RankedCourierView[];
  reasonsBn: string[];
  reasonsEn: string[];
  noteBn: string;
  noteEn: string;
}

const INSUFFICIENT_NOTE = {
  bn: "এখনো কোনো কুরিয়ারের ডেলিভারি ইতিহাস নেই — স্কোর বা সুপারিশ দেখানো যাচ্ছে না। ম্যানুয়ালি কুরিয়ার বেছে নিন; শিপমেন্ট বাড়লে সুপারিশ চালু হবে।",
  en: "No courier has any delivery history yet — no score or recommendation can be shown. Choose a courier manually; recommendations appear once shipments accumulate.",
} as const;

/**
 * Pure classifier (smoke-tested): engine result + the stats it ran
 * over -> the honest status. Zero terminal history anywhere means
 * "insufficient_data" regardless of what the arithmetic produced.
 */
export function classifyRecommendation(
  result: CourierAssignmentResult,
  stats: readonly CourierAssignmentStats[],
): { status: RecommendationStatus; historyShipments: number } {
  const historyShipments = stats.reduce((sum, s) => sum + s.delivered + s.failed + s.returned, 0);
  if (historyShipments === 0) return { status: "insufficient_data", historyShipments };
  if (!result.chosen) return { status: "no_eligible", historyShipments };
  return { status: "ok", historyShipments };
}

function withHistoryFlags(
  list: RankedCourier[],
  statsByProvider: Map<string, CourierAssignmentStats>,
): RankedCourierView[] {
  return list.map((r) => {
    const s = statsByProvider.get(r.provider);
    return { ...r, hasHistory: !!s && s.delivered + s.failed + s.returned > 0 };
  });
}

export type RecommendationResult =
  | { ok: true; value: BookingRecommendation }
  | { ok: false; code: "ORDER_NOT_FOUND" | "ORDER_CLOSED" | "INVALID_INPUT"; error: string };

/**
 * Ranked courier recommendation for booking the given lines of an
 * order (all lines at full quantity when `items` is omitted/empty).
 * Read-only: creates nothing.
 */
export async function getBookingRecommendation(
  orderId: string,
  items?: RecommendationLineInput[],
): Promise<RecommendationResult> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: {
      id: true,
      status: true,
      district: true,
      paymentMethod: true,
      items: {
        select: { id: true, unitPricePoisha: true, quantity: true, variantId: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!order) return { ok: false, code: "ORDER_NOT_FOUND", error: "Order not found. / অর্ডার পাওয়া যায়নি।" };
  if (order.status === "CANCELLED" || order.status === "REFUNDED" || order.status === "RETURNED") {
    return { ok: false, code: "ORDER_CLOSED", error: `Order is ${order.status}; no new shipments can be booked.` };
  }

  const itemById = new Map(order.items.map((i) => [i.id, i]));
  const requested: { line: (typeof order.items)[number]; quantity: number }[] = [];
  if (items && items.length > 0) {
    const seen = new Set<string>();
    for (const item of items) {
      const line = itemById.get(item.orderItemId);
      if (!line) {
        return { ok: false, code: "INVALID_INPUT", error: `Line ${item.orderItemId} does not belong to this order.` };
      }
      if (!Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > line.quantity) {
        return { ok: false, code: "INVALID_INPUT", error: `Invalid quantity for line ${item.orderItemId}.` };
      }
      if (seen.has(item.orderItemId)) {
        return { ok: false, code: "INVALID_INPUT", error: "The same line appears twice; merge the quantities." };
      }
      seen.add(item.orderItemId);
      requested.push({ line, quantity: item.quantity });
    }
  } else {
    for (const line of order.items) requested.push({ line, quantity: line.quantity });
  }
  if (requested.length === 0) {
    return { ok: false, code: "INVALID_INPUT", error: "Order has no lines to book. / অর্ডারে কোনো পণ্য লাইন নেই।" };
  }

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: requested.map((r) => r.line.variantId) } },
    select: { id: true, product: { select: { weightGrams: true } } },
  });
  const weightByVariant = new Map(variants.map((v) => [v.id, v.product.weightGrams ?? null]));
  const { facts, weightEstimated } = buildBookingFacts({
    orderId: order.id,
    district: order.district,
    paymentMethod: order.paymentMethod,
    lines: requested.map((r) => ({
      orderItemId: r.line.id,
      quantity: r.quantity,
      unitPricePoisha: r.line.unitPricePoisha,
      weightGrams: weightByVariant.get(r.line.variantId) ?? null,
    })),
  });

  const built = await buildCourierStatsFromDb();
  const bookable = new Set<string>(SANDBOX_COURIER_PROVIDERS as readonly string[]);
  const stats = built.stats.filter((s) => bookable.has(s.provider));
  const statsByProvider = new Map(stats.map((s) => [s.provider, s]));

  const result = assignCourier(facts, stats);
  const { status, historyShipments } = classifyRecommendation(result, stats);
  const ranked = withHistoryFlags(result.ranked, statsByProvider);
  const excluded = withHistoryFlags(result.excluded, statsByProvider);
  const recommended = ranked[0] ?? null;

  if (status === "insufficient_data") {
    return {
      ok: true,
      value: {
        status,
        facts,
        weightEstimated,
        historyShipments,
        shipmentCount: built.shipmentCount,
        recommended: null,
        ranked: [],
        excluded,
        reasonsBn: [],
        reasonsEn: [],
        noteBn: INSUFFICIENT_NOTE.bn,
        noteEn: INSUFFICIENT_NOTE.en,
      },
    };
  }
  return {
    ok: true,
    value: {
      status,
      facts,
      weightEstimated,
      historyShipments,
      shipmentCount: built.shipmentCount,
      recommended,
      ranked,
      excluded,
      reasonsBn: result.reasonsBn,
      reasonsEn: result.reasonsEn,
      noteBn:
        status === "no_eligible"
          ? "কোনো কুরিয়ারই এই অর্ডারের জন্য যোগ্য নয় (নিচে কারণসহ)। তবু বুকিং করতে চাইলে ম্যানুয়ালি বেছে নিন।"
          : "স্কোর আসল শিপমেন্ট ইতিহাস থেকে; সক্ষমতা (জোন/ওজনসীমা/ETA) কুরিয়ার ক্যাটালগ থেকে।",
      noteEn:
        status === "no_eligible"
          ? "No courier is eligible for this order (reasons below). Booking manually is still possible."
          : "Scores come from real shipment history; capabilities (zones/weight limits/ETA) come from the courier catalogue.",
    },
  };
}
