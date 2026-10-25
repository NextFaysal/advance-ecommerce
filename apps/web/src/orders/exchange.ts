/**
 * Exchange execution — doc 17 batch O7 (part 2).
 *
 * Turns an approved/received return into a REAL replacement order,
 * settling the value difference honestly in both directions.
 *
 * ACCEPTED RETURN STATUSES: APPROVED or RECEIVED (the shared-contract
 * lifecycle REQUESTED → APPROVED/REJECTED → RECEIVED → COMPLETED).
 * RETURNED is accepted as the same received-state under the legacy
 * enum. Why these: before approval the shop has not agreed to take
 * the goods back, so no replacement may ship; after COMPLETED /
 * REFUNDED / EXCHANGED the return is closed. When the return is only
 * APPROVED (goods still in transit) the money math uses its REQUESTED
 * lines; once RECEIVED it uses the received lines — loadReturnLines
 * resolves whichever the core persisted.
 *
 * MONEY RULE (exact):
 *   returnedGoods    = Σ return-line qty × snapshot unit price
 *                      (the price the customer PAID — the line's own
 *                      snapshot when stored, else the OrderItem's;
 *                      on a RECEIVED return, DAMAGED lines are
 *                      excluded — the core never refunds them, so
 *                      they earn no exchange credit either)
 *   replacementGoods = Σ replacement qty × CURRENT catalog price
 *   difference       = replacementGoods − returnedGoods
 * The replacement order is created through createManualOrder at full
 * catalog prices with shippingOverridePoisha = 0 — exchange
 * replacements ship free, so the replacement's total IS
 * replacementGoods and the arithmetic below is exact. The returned
 * goods' value is then applied to the replacement as a CREDIT:
 * a Payment row (method COD, paidPoisha = min(returnedGoods, total),
 * gatewayTransactionId "exchange-credit:<returnId>" as the dedupe
 * anchor — the courier-COD recording pattern) followed by
 * markOrderPayment(source "exchange_credit"), which recomputes the
 * replacement's paymentStatus from rows. Therefore:
 *   difference > 0 → replacement stays PARTIAL with exactly
 *                    `difference` still payable (a normal COD debt).
 *   difference = 0 → replacement is PAID in full by the credit;
 *                    no other money moves.
 *   difference < 0 → credit covers the replacement in full AND the
 *                    excess (−difference) becomes a PENDING refund on
 *                    the ORIGINAL order via the refund workbench
 *                    (createRefund — staff still send that money
 *                    themselves; the workbench only records it). If
 *                    the workbench refuses (e.g. the original order's
 *                    payment was never recorded as paid, so its
 *                    refundable balance is short), the exchange still
 *                    stands and the failure rides in the result +
 *                    the original order's timeline — never hidden.
 *
 * MANUAL-CREATE LIMITS this design works within (investigated, not
 * assumed): createManualOrder DOES take per-line staff prices, but
 * repricing lines to force a difference-only total would corrupt the
 * replacement's line snapshots, so prices stay at catalog and the
 * difference is settled by the credit Payment above instead. Manual
 * create also runs the real fraud scoring on the customer's phone —
 * a FRAUD_BLOCKED result fails the exchange with that code, exactly
 * as it would fail a phone order.
 *
 * DOUBLE-EXCHANGE GUARD: createManualOrder gets a DETERMINISTIC
 * idempotency key derived from the return id (a replay returns the
 * stored replacement instead of a second order), the credit Payment
 * is anchored by its unique gatewayTransactionId, and an OrderNote
 * marker "exchange-return:<returnId>" on the ORIGINAL order is
 * checked before anything is created and written after success.
 * The replacement order id is recorded: in that marker note (with
 * the replacement orderNo), in the replacement's own create note
 * (internalNote names the original order + return id), in this
 * module's audit row, and — under the legacy status enum — by moving
 * the return to EXCHANGED. Under the O7 lifecycle (…→ COMPLETED) the
 * return's status is O7-1's to move; the parent wires their
 * completion transition if they want it automatic.
 */
import { createHash } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import { writeAudit } from "@/lib/audit";
import { createManualOrder, type ManualOrderActor } from "./manual-create";
import { createRefund } from "./refunds";
import { markOrderPayment } from "./repository";
import { loadReturnLines, returnedGoodsPoisha } from "./return-lines";
import { addOrderTimelineNote } from "@/shipments/split-shipments";

export type ExchangeActor = ManualOrderActor;

const ACCEPTED_STATUSES: ReadonlySet<string> = new Set(["APPROVED", "RECEIVED", "RETURNED"]);

export type ExchangeErrorCode =
  | "RETURN_NOT_FOUND"
  | "RETURN_NOT_EXCHANGEABLE"
  | "ALREADY_EXCHANGED"
  | "RETURN_LINES_UNREADABLE"
  | "VARIANT_NOT_FOUND"
  | "CREATE_FAILED";

export type ExchangeResult =
  | {
      ok: true;
      returnId: string;
      originalOrderId: string;
      originalOrderNo: string;
      replacementOrderId: string;
      replacementOrderNo: string;
      returnedGoodsPoisha: number;
      replacementGoodsPoisha: number;
      /** replacementGoods − returnedGoods (signed). */
      differencePoisha: number;
      /** Credit Payment applied to the replacement (poisha). */
      creditAppliedPoisha: number;
      /** Still payable on the replacement = max(difference, 0). */
      payablePoisha: number;
      /** PENDING refund created on the ORIGINAL order (difference < 0). */
      refundId: string | null;
      /** Set when the excess refund could NOT be recorded. */
      refundError: string | null;
    }
  | { ok: false; code: ExchangeErrorCode; error: string };

const fail = (code: ExchangeErrorCode, error: string): ExchangeResult => ({ ok: false, code, error });

/** Deterministic UUID from the return id (idempotency, see header). */
function exchangeIdempotencyKey(returnId: string): string {
  const h = createHash("sha256").update(`exchange:${returnId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function executeExchange(
  returnId: string,
  items: { variantId: string; quantity: number }[],
  actor: ExchangeActor,
): Promise<ExchangeResult> {
  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    items.some((i) => !i.variantId || !Number.isInteger(i.quantity) || i.quantity <= 0)
  ) {
    return fail(
      "VARIANT_NOT_FOUND",
      "Replacement items are required (variantId + positive quantity). / বদলি পণ্য আবশ্যক।",
    );
  }

  const ret = await prisma.return.findFirst({
    where: { id: returnId, deletedAt: null },
    select: { id: true, orderId: true, status: true },
  });
  if (ret === null) {
    return fail("RETURN_NOT_FOUND", "Return not found. / রিটার্ন পাওয়া যায়নি।");
  }
  if (!ACCEPTED_STATUSES.has(ret.status)) {
    return fail(
      "RETURN_NOT_EXCHANGEABLE",
      `A return in status ${ret.status} cannot be exchanged — it must be APPROVED or RECEIVED first. / ${ret.status} অবস্থায় থাকা রিটার্ন বদলি করা যাবে না — আগে APPROVED বা RECEIVED হতে হবে।`,
    );
  }

  const original = await prisma.order.findFirst({
    where: { id: ret.orderId, deletedAt: null },
    select: {
      id: true,
      orderNo: true,
      customerName: true,
      customerPhone: true,
      division: true,
      district: true,
      upazila: true,
      union: true,
      addressLine: true,
    },
  });
  if (original === null) {
    return fail("RETURN_NOT_FOUND", "Original order not found. / মূল অর্ডার পাওয়া যায়নি।");
  }

  // Double-exchange guard (marker note — the courier-COD pattern).
  const marker = `exchange-return:${returnId}`;
  const prior = await prisma.orderNote.findFirst({
    where: { orderId: original.id, text: { contains: marker } },
    select: { id: true },
  });
  if (prior !== null) {
    return fail(
      "ALREADY_EXCHANGED",
      "This return has already been exchanged. / এই রিটার্নের বদলি ইতিমধ্যে সম্পন্ন হয়েছে।",
    );
  }

  // Returned goods value from the return's own lines. On a RECEIVED
  // return, DAMAGED lines earn no credit (the core never refunds
  // them either — see ReturnItemCondition); on an APPROVED return no
  // condition is recorded yet, so every line counts at its requested
  // quantity.
  const allReturnedLines = await loadReturnLines(returnId);
  if (allReturnedLines.length === 0) {
    return fail(
      "RETURN_LINES_UNREADABLE",
      "The return's lines could not be read, so its value cannot be settled. / রিটার্নের পণ্যের তালিকা পড়া যায়নি — মূল্য মেলানো যাচ্ছে না।",
    );
  }
  const returnedLines =
    ret.status === "RECEIVED"
      ? allReturnedLines.filter((l) => l.condition !== "DAMAGED")
      : allReturnedLines;
  const returnedGoods = returnedGoodsPoisha(returnedLines);

  // Replacement goods at CURRENT catalog prices.
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: items.map((i) => i.variantId) } },
    select: { id: true, pricePoisha: true },
  });
  const priceById = new Map(variants.map((v) => [v.id, v.pricePoisha]));
  let replacementGoods = 0;
  const pricedItems: { variantId: string; quantity: number; unitPricePoisha: number }[] = [];
  for (const item of items) {
    const price = priceById.get(item.variantId);
    if (price === undefined) {
      return fail(
        "VARIANT_NOT_FOUND",
        `Replacement variant not found: ${item.variantId} / বদলি পণ্যের ভ্যারিয়েন্ট পাওয়া যায়নি।`,
      );
    }
    replacementGoods += price * item.quantity;
    pricedItems.push({ variantId: item.variantId, quantity: item.quantity, unitPricePoisha: price });
  }

  const difference = replacementGoods - returnedGoods;

  // Create the replacement order (full catalog value, free shipping —
  // see the header for why the total must equal replacementGoods).
  const created = await createManualOrder(
    {
      phone: original.customerPhone,
      customerName: original.customerName,
      address: {
        division: original.division,
        district: original.district,
        upazila: original.upazila,
        ...(original.union ? { union: original.union } : {}),
        addressLine: original.addressLine,
      },
      items: pricedItems,
      paymentMethod: "cod",
      shippingMethod:
        original.district.trim().toLowerCase() === "dhaka" ? "inside_dhaka" : "outside_dhaka",
      shippingOverridePoisha: 0,
      source: "exchange",
      internalNote: `বদলি অর্ডার — মূল অর্ডার ${original.orderNo}, রিটার্ন ${returnId}। ফেরত পণ্যের মূল্য ${returnedGoods} পয়সা ক্রেডিট হিসেবে ধরা হয়েছে; বদলি পণ্যের মূল্য ${replacementGoods} পয়সা। / Exchange for order ${original.orderNo}, return ${returnId}: returned goods credit ${returnedGoods} poisha, replacement goods ${replacementGoods} poisha, difference ${difference} poisha.`,
      idempotencyKey: exchangeIdempotencyKey(returnId),
    },
    actor,
  );
  if (!created.ok) {
    return fail(
      "CREATE_FAILED",
      `Replacement order could not be created (${created.code}): ${created.message}`,
    );
  }
  const replacementOrderId = created.orderId;
  const replacementOrderNo = created.orderNo;
  const replacementTotal = created.pricing?.totalPoisha ?? replacementGoods;

  // Apply the returned-goods credit to the replacement (dedupe by
  // the unique gatewayTransactionId anchor).
  const creditTxId = `exchange-credit:${returnId}`;
  const creditApplied = Math.min(returnedGoods, replacementTotal);
  if (creditApplied > 0) {
    const existingCredit = await prisma.payment.findFirst({
      where: { orderId: replacementOrderId, gatewayTransactionId: creditTxId, deletedAt: null },
      select: { id: true },
    });
    if (existingCredit === null) {
      await prisma.payment.create({
        data: {
          orderId: replacementOrderId,
          method: "COD",
          amountPoisha: creditApplied,
          paidPoisha: creditApplied,
          status: "PAID",
          // No gateway exists for a goods credit; the source marking
          // lives in the timeline note below (Payment has no note
          // column) — the courier-COD recording convention.
          gatewayTransactionId: creditTxId,
        },
      });
      await markOrderPayment(replacementOrderId, {
        source: "exchange_credit",
        reference: returnId,
      });
      await addOrderTimelineNote(
        replacementOrderId,
        `রিটার্ন ক্রেডিট প্রয়োগ হয়েছে: মূল অর্ডার ${original.orderNo} থেকে ফেরত পণ্যের ${creditApplied} পয়সা এই অর্ডারে জমা ধরা হয়েছে [${creditTxId}] / Return credit applied: ${creditApplied} poisha of returned goods from order ${original.orderNo} credited to this order [${creditTxId}].`,
      );
    }
  }

  // Excess credit (difference < 0) → PENDING refund on the ORIGINAL.
  let refundId: string | null = null;
  let refundError: string | null = null;
  if (difference < 0) {
    const refund = await createRefund(
      original.id,
      {
        amountPoisha: -difference,
        method: "other",
        reason: `বদলির অতিরিক্ত ক্রেডিট — রিটার্ন ${returnId}: ফেরত পণ্যের মূল্য বদলি পণ্যের চেয়ে ${-difference} পয়সা বেশি। / Exchange excess credit — return ${returnId}: returned goods exceeded the replacement by ${-difference} poisha.`,
      },
      actor.id,
    );
    if (refund.ok) {
      refundId = refund.value.refund.id;
    } else {
      refundError = `${refund.code}: ${refund.error}`;
    }
  }

  // Marker + summary note on the ORIGINAL order (the guard above
  // reads this note; it also names the replacement for staff).
  await addOrderTimelineNote(
    original.id,
    `বদলি সম্পন্ন: রিটার্ন ${returnId}-এর বদলে নতুন অর্ডার ${replacementOrderNo} তৈরি হয়েছে। ফেরত ${returnedGoods} পয়সা, বদলি ${replacementGoods} পয়সা, পার্থক্য ${difference} পয়সা। [${marker}] / Exchange completed: return ${returnId} replaced by order ${replacementOrderNo}. Returned ${returnedGoods} poisha, replacement ${replacementGoods} poisha, difference ${difference} poisha. [${marker}]${
      refundId !== null ? ` অতিরিক্ত অর্থের রিফান্ড (PENDING) তৈরি হয়েছে: ${refundId}। / Excess refund (PENDING) created: ${refundId}.` : ""
    }${refundError !== null ? ` সতর্কতা: অতিরিক্ত অর্থের রিফান্ড তৈরি করা যায়নি (${refundError}) — ম্যানুয়ালি দেখুন। / WARNING: the excess refund could not be recorded (${refundError}) — handle manually.` : ""}`,
  );

  // Legacy-enum installs carry an EXCHANGED terminal state; under the
  // O7 lifecycle the return's status belongs to the RMA core, so a
  // rejected update here is expected there and simply skipped. The
  // call goes through a structural cast so this file compiles against
  // either generation of the ReturnStatus enum.
  try {
    const updateReturn = prisma.return.update as unknown as (
      args: unknown,
    ) => Promise<unknown>;
    await updateReturn({ where: { id: returnId }, data: { status: "EXCHANGED" } });
  } catch {
    // Status vocabulary without EXCHANGED (O7 lifecycle) — the
    // marker note + audit row above are the durable exchange record.
  }

  await writeAudit({
    actorId: actor.id,
    action: "returns.exchange",
    entityType: "Return",
    entityId: returnId,
    afterJson: {
      originalOrderId: original.id,
      originalOrderNo: original.orderNo,
      replacementOrderId,
      replacementOrderNo,
      returnedGoodsPoisha: returnedGoods,
      replacementGoodsPoisha: replacementGoods,
      differencePoisha: difference,
      creditAppliedPoisha: creditApplied,
      payablePoisha: Math.max(difference, 0),
      refundId,
      refundError,
    },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return {
    ok: true,
    returnId,
    originalOrderId: original.id,
    originalOrderNo: original.orderNo,
    replacementOrderId,
    replacementOrderNo,
    returnedGoodsPoisha: returnedGoods,
    replacementGoodsPoisha: replacementGoods,
    differencePoisha: difference,
    creditAppliedPoisha: creditApplied,
    payablePoisha: Math.max(difference, 0),
    refundId,
    refundError,
  };
}
