// Courier -> order synchronisation (doc 17 batch O5, wave 23).
//
// THE seam between courier events and the order state machine. Until
// this module existed, courier webhooks updated the Shipment row and
// reconciled invoices, but the linked Order NEVER moved — staff had to
// mirror every delivery by hand. This helper is the single place that
// turns a courier event into order transitions, and it does so ONLY
// through applyOrderTransition (src/orders/repository), so the state
// machine, the delivered-order fan-out (loyalty / reseller / vendor
// credits), stock-reservation release and reversal hooks all fire
// exactly as they do for a staff-driven move.
//
// Callers: the public courier webhook route (app/api/v1/public/couriers/
// webhook) and the rider-delivery sync (provider "rider", O5-2).
//
// Conventions:
//  - Actor: the system label "system" (repository convention: a
//    changedBy that is not a real User id persists as NULL and reads
//    back as "system"). The provider + event ride in the transition
//    reasons and in bilingual OrderNote timeline entries.
//  - Idempotency: couriers retry webhooks. Asking for a state the
//    order is already at/past returns { applied: false, reason:
//    "already" } and writes nothing (the webhook layer additionally
//    dedupes by its idempotency key before this helper is reached).
//  - A PENDING (never confirmed) order is NEVER forced forward: the
//    event is noted on the timeline for staff and the caller gets
//    reason "order_not_confirmed".
//  - Business states are reported, never thrown. Only programmer
//    errors (bad arguments) throw.
import { prisma } from "@advance-ecommerce/db";
import { applyOrderTransition, markOrderPayment } from "../orders/repository";
import { ORDER_TRANSITIONS } from "../orders/state-machine";
import type { OrderStatus } from "../orders/types";

export type CourierOrderTarget = "SHIPPED" | "DELIVERED" | "RETURNED";

export interface CourierEventMeta {
  provider: string;
  eventId?: string;
  codCollectedPoisha?: number;
  note?: string;
}

export interface CourierSyncResult {
  applied: boolean;
  reason?: string;
  from?: string;
  to?: string;
}

const SYSTEM_ACTOR = "system";

/** Forward-progress rank for the at/past check on SHIPPED/DELIVERED. */
const FORWARD_RANK: Partial<Record<OrderStatus, number>> = {
  PENDING: 0,
  CONFIRMED: 1,
  PROCESSING: 2,
  PACKED: 3,
  SHIPPED: 4,
  DELIVERED: 5,
};

/** Statuses that mean the order already went through a return. */
const RETURNED_LIKE: readonly OrderStatus[] = ["RETURNED", "REFUNDED", "EXCHANGED"];

/**
 * Shortest legal path from `from` to `to` over ORDER_TRANSITIONS
 * (BFS), returned as the list of hop targets excluding `from` and
 * including `to`. Null when the machine offers no path.
 */
function findTransitionPath(from: OrderStatus, to: OrderStatus): OrderStatus[] | null {
  if (from === to) return [];
  const visited = new Set<OrderStatus>([from]);
  const queue: { status: OrderStatus; path: OrderStatus[] }[] = [{ status: from, path: [] }];
  while (queue.length > 0) {
    const { status, path } = queue.shift()!;
    for (const next of ORDER_TRANSITIONS[status]) {
      if (visited.has(next)) continue;
      const nextPath = [...path, next];
      if (next === to) return nextPath;
      visited.add(next);
      queue.push({ status: next, path: nextPath });
    }
  }
  return null;
}

function eventLabel(meta: CourierEventMeta): string {
  return meta.eventId ? `${meta.provider} event ${meta.eventId}` : `${meta.provider} event`;
}

/**
 * Append a bilingual timeline note (OrderNote, author = system) about
 * a courier event. Used by the helper for every outcome, and exported
 * for the note-only webhook mappings (in_transit / failed / returning)
 * so Order writes stay inside this module.
 */
export async function recordCourierEventNote(
  orderId: string,
  meta: CourierEventMeta,
  text: string,
): Promise<void> {
  await prisma.orderNote.create({
    data: { orderId, authorId: null, text },
  });
  void meta;
}

/**
 * Record courier-collected COD cash against an order, exactly once per
 * (provider, event): creates the COD Payment row for the outstanding
 * part of the collection, then runs the order-paid funnel
 * (markOrderPayment) so paymentStatus is derived, never hand-set.
 *
 * Dedupe layers:
 *  1. outstanding check — money already on the order (any source)
 *     shrinks what can still be recorded; a fully-paid order records
 *     nothing.
 *  2. event marker — the marking OrderNote carries
 *     `courier-cod:<provider>:<eventId>`; a replayed event finds its
 *     marker and records nothing again (protects partial collections,
 *     where the outstanding check alone could not tell a replay from
 *     a second, genuine collection).
 */
async function recordCourierCodCollection(
  order: { id: string; totalPoisha: number },
  meta: CourierEventMeta,
): Promise<number> {
  const collected = meta.codCollectedPoisha ?? 0;
  if (collected <= 0) return 0;
  const marker = `courier-cod:${meta.provider}:${meta.eventId ?? "no-event"}`;
  const prior = await prisma.orderNote.findFirst({
    where: { orderId: order.id, text: { contains: marker } },
    select: { id: true },
  });
  if (prior) return 0;
  const [paymentAgg, manualAgg] = await Promise.all([
    prisma.payment.aggregate({
      where: { orderId: order.id, deletedAt: null },
      _sum: { paidPoisha: true },
    }),
    prisma.manualTrxSubmission.aggregate({
      where: { orderId: order.id, status: "APPROVED" },
      _sum: { amountPoisha: true },
    }),
  ]);
  const grossPaid = (paymentAgg._sum.paidPoisha ?? 0) + (manualAgg._sum.amountPoisha ?? 0);
  const outstanding = order.totalPoisha - grossPaid;
  if (outstanding <= 0) return 0;
  const amount = Math.min(collected, outstanding);
  if (amount <= 0) return 0;
  await prisma.payment.create({
    data: {
      orderId: order.id,
      method: "COD",
      amountPoisha: amount,
      paidPoisha: amount,
      status: "PAID",
      // No gateway exists for cash the courier collected; the source
      // marking lives in the timeline note below (Payment has no note
      // column and gatewayTransactionId stays null by design).
      gatewayTransactionId: null,
    },
  });
  await markOrderPayment(order.id, { source: "payment_webhook", reference: meta.eventId });
  await recordCourierEventNote(
    order.id,
    meta,
    `কুরিয়ার COD সংগ্রহ (${eventLabel(meta)}): ${amount} পয়সা সংগৃহীত হিসেবে রেকর্ড করা হয়েছে [${marker}] / Courier COD collected (${eventLabel(meta)}): ${amount} poisha recorded as collected [${marker}].`,
  );
  return amount;
}

/**
 * Move an order to the state a courier event implies, walking the
 * state machine hop by hop through applyOrderTransition:
 *   SHIPPED:   CONFIRMED -> PROCESSING -> PACKED -> SHIPPED (or from
 *              wherever the order legally stands)
 *   DELIVERED: ... -> SHIPPED -> DELIVERED (+ COD collection recorded)
 *   RETURNED:  SHIPPED -> FAILED -> RETURNING -> RETURNED, or
 *              DELIVERED -> RETURN_REQUESTED -> RETURNING -> RETURNED
 * The wave-21 confirm gate is never in the way: this helper never
 * targets CONFIRMED, and the gate only applies to PENDING -> CONFIRMED.
 */
export async function transitionOrderForCourierEvent(
  orderId: string,
  target: CourierOrderTarget,
  meta: CourierEventMeta,
): Promise<CourierSyncResult> {
  if (!orderId) throw new Error("transitionOrderForCourierEvent: orderId is required");
  if (!meta?.provider) throw new Error("transitionOrderForCourierEvent: meta.provider is required");

  const row = await prisma.order.findFirst({
    where: { deletedAt: null, OR: [{ id: orderId }, { orderNo: orderId }] },
    select: { id: true, status: true, totalPoisha: true },
  });
  if (!row) return { applied: false, reason: "order_not_found" };
  const from = row.status as OrderStatus;
  const label = eventLabel(meta);
  const detail = meta.note ? ` — ${meta.note}` : "";

  if (from === "CANCELLED") {
    await recordCourierEventNote(
      row.id,
      meta,
      `কুরিয়ার আপডেট (${label}): অর্ডারটি ইতিমধ্যে বাতিল, তাই "${target}" অবস্থা প্রয়োগ করা হয়নি${detail} / Courier update (${label}): the order is already CANCELLED, so the "${target}" state was not applied${detail}.`,
    );
    return { applied: false, reason: "order_cancelled", from, to: from };
  }

  if (from === "PENDING") {
    await recordCourierEventNote(
      row.id,
      meta,
      `কুরিয়ার আপডেট (${label}): অর্ডারটি এখনো নিশ্চিত হয়নি (PENDING), তাই কুরিয়ারের "${target}" অবস্থা প্রয়োগ করা হয়নি — কর্মীদের সিদ্ধান্ত প্রয়োজন${detail} / Courier update (${label}): the order is still PENDING (never confirmed), so the courier "${target}" state was not applied — staff action needed${detail}.`,
    );
    return { applied: false, reason: "order_not_confirmed", from, to: from };
  }

  // Split-shipment guard (wave 23, doc 17 O5): a DELIVERED event for
  // ONE parcel of a split order must not deliver the whole order. When
  // the order has split shipments and not every allocated line is
  // delivered yet: record any COD the parcel carried (the per-event
  // marker dedupe in recordCourierCodCollection applies), advance
  // only to SHIPPED, note the partial delivery, and report
  // "partial_delivery". The split module is imported dynamically —
  // it imports THIS helper, so a static import would cycle.
  if (target === "DELIVERED") {
    try {
      const split = await import("@/shipments/split-shipments");
      if (
        (await split.orderHasSplitShipments(row.id)) &&
        !(await split.isOrderFullyDelivered(row.id))
      ) {
        await recordCourierCodCollection({ id: row.id, totalPoisha: row.totalPoisha }, meta);
        if ((FORWARD_RANK[from] ?? -1) < (FORWARD_RANK.SHIPPED ?? 0)) {
          await transitionOrderForCourierEvent(row.id, "SHIPPED", {
            ...meta,
            note: `${meta.note ? `${meta.note} · ` : ""}partial delivery (split shipment)`,
          });
        }
        await recordCourierEventNote(
          row.id,
          meta,
          `কুরিয়ার আপডেট (${label}): আংশিক ডেলিভারি — বিভক্ত শিপমেন্টের একটি পার্সেল পৌঁছেছে, কিন্তু সব পণ্য এখনো ডেলিভার হয়নি, তাই অর্ডার DELIVERED করা হয়নি${detail} / Courier update (${label}): partial delivery — one parcel of a split shipment arrived, but not all lines are delivered yet, so the order was NOT marked DELIVERED${detail}.`,
        );
        return { applied: false, reason: "partial_delivery", from, to: from };
      }
    } catch {
      // Split module unavailable: fall through to the whole-order path
      // (pre-split behaviour) rather than dropping the event.
    }
  }

  // Already at/past the target: idempotent no-op for the status. A
  // DELIVERED order can still gain its COD collection from a late or
  // replayed delivered event — recordCourierCodCollection dedupes.
  const alreadyThere =
    target === "RETURNED"
      ? RETURNED_LIKE.includes(from)
      : (FORWARD_RANK[from] ?? -1) >= (FORWARD_RANK[target] ?? Number.POSITIVE_INFINITY);
  if (alreadyThere) {
    if (target === "DELIVERED") {
      await recordCourierCodCollection({ id: row.id, totalPoisha: row.totalPoisha }, meta);
    }
    return { applied: false, reason: "already", from, to: from };
  }

  const path = findTransitionPath(from, target);
  if (!path || path.length === 0) {
    await recordCourierEventNote(
      row.id,
      meta,
      `কুরিয়ার আপডেট (${label}): "${from}" থেকে "${target}" অবস্থায় যাওয়ার বৈধ পথ নেই, তাই প্রয়োগ করা হয়নি${detail} / Courier update (${label}): no legal transition path from "${from}" to "${target}", so nothing was applied${detail}.`,
    );
    return { applied: false, reason: "no_legal_path", from, to: from };
  }

  let current: OrderStatus = from;
  for (const hop of path) {
    const result = await applyOrderTransition(
      row.id,
      hop,
      SYSTEM_ACTOR,
      `Courier (${label}): ${current} -> ${hop}${detail}`,
    );
    if (result.kind !== "ok") {
      await recordCourierEventNote(
        row.id,
        meta,
        `কুরিয়ার আপডেট (${label}): "${hop}" ধাপে থেমে গেছে (${result.kind === "invalid" || result.kind === "blocked" ? result.error : result.kind}) — অর্ডার এখন "${current}" অবস্থায়${detail} / Courier update (${label}): stopped at the "${hop}" step (${result.kind === "invalid" || result.kind === "blocked" ? result.error : result.kind}) — the order is now in "${current}"${detail}.`,
      );
      return { applied: false, reason: `transition_failed:${hop}`, from, to: current };
    }
    current = hop;
  }

  if (target === "DELIVERED") {
    await recordCourierCodCollection({ id: row.id, totalPoisha: row.totalPoisha }, meta);
  }

  await recordCourierEventNote(
    row.id,
    meta,
    `কুরিয়ার আপডেট (${label}): অর্ডার "${from}" থেকে "${target}" অবস্থায় নেওয়া হয়েছে${detail} / Courier update (${label}): order moved from "${from}" to "${target}"${detail}.`,
  );
  return { applied: true, from, to: target };
}

/* ------------------------------------------------------------------ */
/* Parcel weight                                                       */
/* ------------------------------------------------------------------ */

/**
 * Fallback weight for an order line whose variant/product carries no
 * weightGrams: a flat 500 g per LINE (not per unit). There is no
 * Settings key for a default parcel weight (checked src/lib/settings
 * defaults — only shipping.weight_slabs exists, which prices by the
 * total, not per line), so the constant lives here, documented, until
 * a settings surface owns it.
 */
export const DEFAULT_LINE_WEIGHT_GRAMS = 500;

/**
 * Real parcel weight for an order: Σ over lines of
 * (Product.weightGrams × quantity), resolved live through the line's
 * variant (OrderItem rows snapshot name/SKU/price, not weight). A line
 * whose product has no weightGrams — or whose variant has gone —
 * contributes DEFAULT_LINE_WEIGHT_GRAMS for the line.
 */
export async function computeOrderParcelWeightGrams(
  items: readonly { variantId: string; quantity: number }[],
): Promise<number> {
  if (items.length === 0) return 0;
  const variantIds = [...new Set(items.map((i) => i.variantId))];
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, product: { select: { weightGrams: true } } },
  });
  const weightByVariant = new Map(variants.map((v) => [v.id, v.product.weightGrams ?? null]));
  let total = 0;
  for (const item of items) {
    const perUnit = weightByVariant.get(item.variantId);
    total += perUnit ? perUnit * item.quantity : DEFAULT_LINE_WEIGHT_GRAMS;
  }
  return total;
}
