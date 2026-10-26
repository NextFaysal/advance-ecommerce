/**
 * Order merge — ADV-19 (doc 22). Two orders from the same customer,
 * placed separately, ship as ONE parcel: the source order's lines move
 * into the target order, and the source is cancelled.
 *
 * HONESTY CONTRACT — a merge NEVER deletes an order row and never
 * hand-sums money:
 *  - The lines move through the existing order-edit machinery
 *    (editOrderItems), which reprices the target through its own
 *    pricing path (subtotal + shipping engine + coupon re-evaluation)
 *    and reserves the added lines under the guarded stock rules.
 *  - The source's own stock reservations are released ONLY through
 *    the single release path (releaseOrderStockReservations,
 *    ledger-idempotent) — and only when the target edit actually
 *    needs that stock back (see below).
 *  - The source is then CANCELLED through applyOrderTransition with
 *    the reason "অর্ডার মার্জ: <targetOrderNo>", so its status
 *    history, coupon-usage restoration (reversal hooks) and the
 *    automation event all fire exactly as for any staff cancellation.
 *    The row stays fully readable in admin forever.
 *  - Timeline notes are written on BOTH orders and the action is
 *    audited (orders.merge) by the route.
 *
 * Guards (preflightMerge — pure reads, also exposed as a dry run):
 *  - both orders exist and are not soft-deleted; source ≠ target;
 *  - same customer: identical NORMALISED customerPhone (orders store
 *    phones normalised, so equality is exact);
 *  - both statuses in {PENDING, CONFIRMED} — stricter than the edit
 *    service's editable set, because merging into an order that is
 *    already being packed/shipped would strand a parcel;
 *  - neither order has a Shipment row;
 *  - neither order carries money: no Payment with money status
 *    (PAID/PARTIAL/REFUNDED/PARTIALLY_REFUNDED) or paidPoisha > 0, no
 *    PaymentAttempt with money status, Order.paymentStatus not
 *    PAID/PARTIAL, no satisfied advance (advanceSatisfiedAt), no paid
 *    PaymentLink. An UNPAID Payment row with paidPoisha 0 is NORMAL
 *    (checkout creates one per order) and does not block. A target
 *    with an UNPAID advance requirement is fine — its requirement
 *    stands and the edit machinery flags the reconciliation in its
 *    own timeline note.
 *
 * Stock sequencing: the target edit runs FIRST. In the common case it
 * succeeds outright — the source's reservations are still held at
 * that moment, so the edit reserves fresh stock for the target on top
 * (brief double-hold, resolved when the source cancel's release path
 * runs). Only when the edit fails INSUFFICIENT_STOCK do we check
 * whether the source's own outstanding reservations cover the
 * shortfall; if they do, the source reservations are released through
 * the single release path and the edit is retried once. If the retry
 * still fails, the merge aborts with a typed error and an OrderNote on
 * the source documents that its reservations were released by the
 * failed attempt (a re-run then self-heals: the first edit attempt
 * claims the freed stock). Nothing else is written on an abort: the
 * source is NOT cancelled and the target is NOT edited (the edit is
 * one transaction, so a failed attempt leaves no partial lines).
 *
 * Money semantics inherited from the edit machinery, stated plainly:
 * source lines that match a target line's variant merge into that
 * line at the TARGET line's unit price; new variants are priced at
 * the CURRENT catalog price (not the source's snapshot). The source
 * order's coupon/discount does NOT transfer — the source's coupon
 * usage is restored by its cancellation; the target's own coupon (if
 * any) is re-evaluated by the edit and may drop.
 */

import { prisma } from "@advance-ecommerce/db";
import { editOrderItems, type OrderEditActor, type OrderEditOutcome } from "./edit";
import { applyOrderTransition, releaseOrderStockReservations } from "./repository";
import { addQty, stockClaimUnits } from "../lib/quantity";

export const MERGEABLE_ORDER_STATUSES = ["PENDING", "CONFIRMED"] as const;

export interface MergeVerdict {
  code: string;
  ok: boolean;
  /** Bilingual, staff-facing explanation of this verdict. */
  message: string;
}

export interface MergePreflight {
  ok: boolean;
  verdicts: MergeVerdict[];
  source: { id: string; orderNo: string; status: string } | null;
  target: { id: string; orderNo: string; status: string } | null;
}

export type MergeErrorCode =
  | "INVALID_INPUT"
  | "ORDER_NOT_FOUND"
  | "MERGE_REFUSED"
  | "EDIT_FAILED"
  | "CANCEL_FAILED";

export type MergeResult =
  | {
      ok: true;
      value: {
        sourceOrderId: string;
        sourceOrderNo: string;
        targetOrderId: string;
        targetOrderNo: string;
        edit: OrderEditOutcome;
        /** True when the source's reservations had to be released
         *  before the target edit could reserve the lines. */
        sourceReservationsReleasedEarly: boolean;
        movedLines: { variantId: string; quantity: number }[];
      };
    }
  | { ok: false; code: MergeErrorCode; error: string; verdicts?: MergeVerdict[] };

const MONEY_PAYMENT_STATUSES = ["PAID", "PARTIAL", "REFUNDED", "PARTIALLY_REFUNDED"] as const;

interface MergeSide {
  id: string;
  orderNo: string;
  status: string;
  customerPhone: string;
  paymentStatus: string;
  advanceSatisfiedAt: Date | null;
}

/** Pure-read guard evaluation for one ordered (source, target) pair. */
export async function preflightMerge(
  sourceOrderId: string,
  targetOrderId: string,
): Promise<MergePreflight> {
  const verdicts: MergeVerdict[] = [];
  const push = (code: string, ok: boolean, message: string) => {
    verdicts.push({ code, ok, message });
    return ok;
  };

  if (!sourceOrderId || !targetOrderId || sourceOrderId === targetOrderId) {
    push(
      "SAME_ORDER",
      false,
      "সোর্স ও টার্গেট একই অর্ডার হতে পারে না / Source and target must be two different orders.",
    );
    return { ok: false, verdicts, source: null, target: null };
  }

  const rows = await prisma.order.findMany({
    where: { id: { in: [sourceOrderId, targetOrderId] }, deletedAt: null },
    select: {
      id: true,
      orderNo: true,
      status: true,
      customerPhone: true,
      paymentStatus: true,
      advanceSatisfiedAt: true,
    },
  });
  const sourceRow = rows.find((r) => r.id === sourceOrderId) ?? null;
  const targetRow = rows.find((r) => r.id === targetOrderId) ?? null;
  const source: MergeSide | null = sourceRow;
  const target: MergeSide | null = targetRow;

  if (!source || !target) {
    push(
      "ORDER_NOT_FOUND",
      false,
      !source && !target
        ? "দুটি অর্ডারের একটিও পাওয়া যায়নি / Neither order was found."
        : !source
          ? "সোর্স অর্ডার পাওয়া যায়নি / The source order was not found."
          : "টার্গেট অর্ডার পাওয়া যায়নি / The target order was not found.",
    );
    return {
      ok: false,
      verdicts,
      source: source ? { id: source.id, orderNo: source.orderNo, status: source.status } : null,
      target: target ? { id: target.id, orderNo: target.orderNo, status: target.status } : null,
    };
  }

  push(
    "SAME_CUSTOMER",
    source.customerPhone === target.customerPhone,
    source.customerPhone === target.customerPhone
      ? "একই গ্রাহক (ফোন নম্বর মিলেছে) / Same customer — phone numbers match."
      : "দুটি অর্ডারের গ্রাহকের ফোন নম্বর আলাদা — আলাদা গ্রাহকের অর্ডার মার্জ করা যাবে না / The two orders belong to different phone numbers and cannot be merged.",
  );

  for (const [side, label] of [
    [source, "সোর্স"],
    [target, "টার্গেট"],
  ] as const) {
    push(
      `STATUS_${label === "সোর্স" ? "SOURCE" : "TARGET"}`,
      (MERGEABLE_ORDER_STATUSES as readonly string[]).includes(side.status),
      (MERGEABLE_ORDER_STATUSES as readonly string[]).includes(side.status)
        ? `${label} অর্ডার ${side.orderNo} মার্জযোগ্য অবস্থায় আছে (${side.status}) / ${side.orderNo} is in a mergeable status (${side.status}).`
        : `${label} অর্ডার ${side.orderNo} এখন ${side.status} অবস্থায় — শুধু PENDING/CONFIRMED অর্ডার মার্জ করা যায় / ${side.orderNo} is ${side.status} — only PENDING/CONFIRMED orders can be merged.`,
    );
  }

  const orderIds = [source.id, target.id];
  const [shipmentCount, moneyPayments, moneyAttempts, paidLinks] = await Promise.all([
    prisma.shipment.count({ where: { orderId: { in: orderIds }, deletedAt: null } }),
    prisma.payment.count({
      where: {
        orderId: { in: orderIds },
        deletedAt: null,
        OR: [{ status: { in: [...MONEY_PAYMENT_STATUSES] } }, { paidPoisha: { gt: 0 } }],
      },
    }),
    prisma.paymentAttempt.count({
      where: { orderId: { in: orderIds }, status: { in: [...MONEY_PAYMENT_STATUSES] } },
    }),
    prisma.paymentLink.count({
      where: { orderId: { in: orderIds }, OR: [{ paidAt: { not: null } }, { status: "PAID" }] },
    }),
  ]);

  push(
    "NO_SHIPMENTS",
    shipmentCount === 0,
    shipmentCount === 0
      ? "কোনো অর্ডারেই শিপমেন্ট তৈরি হয়নি / Neither order has a shipment yet."
      : "কোনো একটি অর্ডারে ইতিমধ্যে শিপমেন্ট তৈরি হয়েছে — পাঠানো শুরু হওয়া অর্ডার মার্জ করা যাবে না / One of the orders already has a shipment and cannot be merged.",
  );

  const moneyFree =
    moneyPayments === 0 &&
    moneyAttempts === 0 &&
    paidLinks === 0 &&
    source.advanceSatisfiedAt === null &&
    target.advanceSatisfiedAt === null &&
    source.paymentStatus !== "PAID" &&
    source.paymentStatus !== "PARTIAL" &&
    target.paymentStatus !== "PAID" &&
    target.paymentStatus !== "PARTIAL";
  push(
    "NO_MONEY_MOVED",
    moneyFree,
    moneyFree
      ? "কোনো অর্ডারেই টাকা জমা পড়েনি (COD-অপরিশোধিত) / No money has been collected on either order (COD-unpaid)."
      : "কোনো একটি অর্ডারে টাকা জমা পড়েছে বা অগ্রিম পরিশোধিত — টাকা জড়িত অর্ডার মার্জ করা যাবে না, আগে রিফান্ড/মীমাংসা করুন / Money has moved on one of the orders (payment or satisfied advance) — settle/refund first; paid orders are never merged.",
  );

  return {
    ok: verdicts.every((v) => v.ok),
    verdicts,
    source: { id: source.id, orderNo: source.orderNo, status: source.status },
    target: { id: target.id, orderNo: target.orderNo, status: target.status },
  };
}

/** Outstanding (reserved − released) quantities per variant for an
 *  order, recomputed from the stock ledger — the same source of truth
 *  releaseOrderStockReservations uses. */
async function outstandingReservations(orderId: string): Promise<Map<string, number>> {
  const movements = await prisma.stockMovement.findMany({
    where: {
      referenceType: "ORDER",
      referenceId: orderId,
      type: { in: ["SALE_RESERVE", "SALE_RELEASE"] },
    },
    select: { variantId: true, type: true, quantityDelta: true },
  });
  const byVariant = new Map<string, number>();
  for (const m of movements) {
    // SALE_RESERVE rows carry a negative delta (stock claimed);
    // SALE_RELEASE rows a positive one (stock returned). Outstanding
    // = claimed − returned, per variant.
    const signed = -m.quantityDelta;
    byVariant.set(m.variantId, (byVariant.get(m.variantId) ?? 0) + signed);
  }
  return byVariant;
}

async function addTimelineNote(orderId: string, authorId: string, text: string): Promise<void> {
  const author = await prisma.user.findUnique({ where: { id: authorId }, select: { id: true } });
  await prisma.orderNote.create({
    data: { orderId, authorId: author?.id ?? null, text },
  });
}

export async function mergeOrders(
  sourceOrderId: string,
  targetOrderId: string,
  actor: OrderEditActor,
): Promise<MergeResult> {
  if (!sourceOrderId || !targetOrderId || sourceOrderId === targetOrderId) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      error: "সোর্স ও টার্গেট হিসেবে দুটি আলাদা অর্ডার লাগবে / Two different orders are required.",
    };
  }

  const preflight = await preflightMerge(sourceOrderId, targetOrderId);
  if (!preflight.ok || !preflight.source || !preflight.target) {
    return {
      ok: false,
      code: preflight.verdicts.some((v) => v.code === "ORDER_NOT_FOUND")
        ? "ORDER_NOT_FOUND"
        : "MERGE_REFUSED",
      error:
        preflight.verdicts.find((v) => !v.ok)?.message ??
        "মার্জ করা যাবে না / The merge was refused.",
      verdicts: preflight.verdicts,
    };
  }
  const source = preflight.source;
  const target = preflight.target;

  // Aggregate the source's lines by variant — the edit machinery
  // merges same-variant adds into the target's existing line (at the
  // target line's price) and prices new variants at current catalog.
  const sourceItems = await prisma.orderItem.findMany({
    where: { orderId: source.id },
    select: { variantId: true, quantity: true },
  });
  if (sourceItems.length === 0) {
    return {
      ok: false,
      code: "MERGE_REFUSED",
      error: "সোর্স অর্ডারে কোনো আইটেম নেই — খালি অর্ডার মার্জ করার কিছু নেই / The source order has no items to move.",
    };
  }
  const byVariant = new Map<string, number>();
  for (const item of sourceItems) {
    // Wave 59: stored quantities are Decimals — milli-exact sums.
    byVariant.set(item.variantId, addQty(byVariant.get(item.variantId) ?? 0, item.quantity));
  }
  const addItems = [...byVariant.entries()].map(([variantId, quantity]) => ({ variantId, quantity }));

  let releasedEarly = false;
  let edit = await editOrderItems(target.id, { addItems }, actor);
  if (!edit.ok && edit.code === "INSUFFICIENT_STOCK") {
    // Would the source's own held reservations cover the lines? The
    // edit reserves against live stock, which the source's claims
    // still depress. If every source line's outstanding reservation
    // covers the quantity being moved, releasing the source frees
    // exactly enough — release through the single path and retry.
    const outstanding = await outstandingReservations(source.id);
    // Outstanding reservations are whole stock units — compare them
    // against each line's stockClaimUnits, not its raw quantity.
    const covered = addItems.every((a) => (outstanding.get(a.variantId) ?? 0) >= stockClaimUnits(a.quantity));
    if (covered) {
      await releaseOrderStockReservations(source.id);
      releasedEarly = true;
      edit = await editOrderItems(target.id, { addItems }, actor);
    }
  }
  if (!edit.ok) {
    if (releasedEarly) {
      // Honest trace of the one state change an aborted merge made:
      // the source's reservations are released (its lines are now
      // unreserved but the order itself is untouched and NOT
      // cancelled). A re-run self-heals — the first edit attempt can
      // claim the freed stock.
      await addTimelineNote(
        source.id,
        actor.id,
        `অর্ডার মার্জের চেষ্টা ব্যর্থ হয়েছে (${target.orderNo}-তে মার্জ হয়নি): ${edit.error} এই চেষ্টায় এই অর্ডারের স্টক রিজার্ভ ছেড়ে দেওয়া হয়েছিল — অর্ডারটি বাতিল হয়নি, মার্জ আবার চালালে মিলে যাবে। / A merge into ${target.orderNo} was attempted and failed; this order's stock reservations were released during the attempt. The order was NOT cancelled — re-running the merge will reconcile.`,
      ).catch(() => undefined);
    }
    return {
      ok: false,
      code: "EDIT_FAILED",
      error: `টার্গেট অর্ডারে আইটেম যোগ করা যায়নি — মার্জ বাতিল হয়েছে, কোনো অর্ডারই বদলায়নি / Could not move the items into the target order; the merge was aborted and neither order changed: ${edit.error}`,
    };
  }

  // Lines are on the target and repriced. Cancel the source through
  // the canonical transition: history row with the merge reason,
  // reservation release (no-op if already released above), coupon
  // restoration and the status-changed automation event all fire.
  const cancelReason = `অর্ডার মার্জ: ${target.orderNo}`;
  const transition = await applyOrderTransition(source.id, "CANCELLED", actor.id, cancelReason);
  if (transition.kind !== "ok") {
    return {
      ok: false,
      code: "CANCEL_FAILED",
      error:
        `আইটেম টার্গেট অর্ডারে চলে গেছে, কিন্তু সোর্স অর্ডার বাতিল করা যায়নি (${transition.kind}) — স্টাফদের হাতে সোর্স অর্ডারটি বাতিল করতে হবে, আইটেম দুই জায়গায় গোনা যাবে না / The items moved to the target, but the source order could not be cancelled (${transition.kind}) — staff must cancel the source manually; do not count its items twice.`,
    };
  }

  await addTimelineNote(
    target.id,
    actor.id,
    `অর্ডার মার্জ: ${source.orderNo} অর্ডারের ${addItems.length} ধরনের আইটেম এই অর্ডারে যোগ হয়েছে; ${source.orderNo} বাতিল করা হয়েছে। মোট এখন অর্ডারের নিজের প্রাইসিং পথে পুনঃহিসাবকৃত। / Order merge: items from ${source.orderNo} were added to this order and ${source.orderNo} was cancelled. Totals were recomputed by this order's own pricing path.`,
  ).catch(() => undefined);
  await addTimelineNote(
    source.id,
    actor.id,
    `অর্ডার মার্জ: এই অর্ডারের সব আইটেম ${target.orderNo} অর্ডারে স্থানান্তরিত হয়েছে, তাই এই অর্ডারটি বাতিল করা হলো। অর্ডার রেকর্ডটি মোছা হয়নি — হিসাবের জন্য এখানেই থাকছে। / Order merge: all items moved to ${target.orderNo}; this order was cancelled for that reason. The record is kept (never deleted) for accounting.`,
  ).catch(() => undefined);

  return {
    ok: true,
    value: {
      sourceOrderId: source.id,
      sourceOrderNo: source.orderNo,
      targetOrderId: target.id,
      targetOrderNo: target.orderNo,
      edit: edit.value,
      sourceReservationsReleasedEarly: releasedEarly,
      movedLines: addItems,
    },
  };
}
