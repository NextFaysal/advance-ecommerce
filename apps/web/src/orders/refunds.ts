/**
 * Refund workbench — doc 17 batch O0 (money integrity).
 *
 * Before this module the ONLY writer of Refund rows was the sandbox
 * payment gateway (status "COMPLETED"), so money collected the real BD
 * way — an approved manual TrxID, a payment link, COD cash — had NO
 * in-system refund path: staff refunded off-book with no record and no
 * audit. This service gives refunds a real lifecycle on ANY order,
 * whatever the payment source:
 *
 *   PENDING ──► SENT ──► CONFIRMED
 *      └────────► CANCELLED
 *
 * HONESTY: the system RECORDS refunds that staff send themselves via
 * bKash / Nagad / bank / cash. It never sends money itself; "SENT"
 * means a human sent it and recorded the payout reference here.
 *
 * Money math mirrors markOrderPayment (src/orders/repository.ts) so the
 * two never disagree about what was paid:
 *   grossPaid = Σ Payment.paidPoisha (not soft-deleted)
 *             + Σ APPROVED ManualTrxSubmission.amountPoisha
 * Refund sums are split by lifecycle meaning:
 *   sentPoisha      — money actually back with the customer:
 *                     status ∈ {SENT, CONFIRMED, COMPLETED}
 *                     (COMPLETED = rows written by the gateway path)
 *   pendingPoisha   — recorded, not yet sent: status = PENDING
 *   committedPoisha — sent + pending (every non-CANCELLED row); the
 *                     over-refund cap is enforced against this, so two
 *                     staff cannot promise the same taka twice.
 *
 * Becoming SENT calls markOrderPayment so Order.paymentStatus is
 * recomputed from rows (REFUNDED / PARTIALLY_REFUNDED) rather than set
 * by hand. Every create and status change is audited with the
 * reason-required sensitive action "orders.refund".
 */
import { prisma } from "@advance-ecommerce/db";

/** The Prisma PaymentMethod enum, derived from the client itself (the
 *  codebase pattern — apps/web has no direct @prisma/client dependency). */
type PaymentMethod = NonNullable<Parameters<typeof prisma.refund.create>[0]["data"]["method"]>;
import { writeAudit } from "@/lib/audit";
import { markOrderPayment } from "./repository";

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

/** How staff actually sent the money back (workbench vocabulary). */
export const REFUND_METHODS = ["bkash", "nagad", "bank", "cash", "gateway", "other"] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

export const REFUND_STATUSES = ["PENDING", "SENT", "CONFIRMED", "CANCELLED"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** Allowed lifecycle moves. CONFIRMED and CANCELLED are terminal. */
const TRANSITIONS: Record<string, readonly RefundStatus[]> = {
  PENDING: ["SENT", "CANCELLED"],
  SENT: ["CONFIRMED"],
  CONFIRMED: [],
  CANCELLED: [],
};

/**
 * The Refund.method column is the coarse PaymentMethod enum (kept for
 * the gateway path + existing reports). The precise workbench channel
 * lives in Refund.payoutMethod; the enum gets the closest honest value.
 */
const METHOD_ENUM: Record<RefundMethod, PaymentMethod> = {
  bkash: "BKASH",
  nagad: "NAGAD",
  bank: "MANUAL_MOBILE_BANKING",
  cash: "COD",
  gateway: "SSLCOMMERZ",
  other: "MANUAL_MOBILE_BANKING",
};

/** Reverse view for rows that predate payoutMethod (gateway rows). */
const ENUM_TO_METHOD: Partial<Record<string, RefundMethod>> = {
  BKASH: "bkash",
  NAGAD: "nagad",
  COD: "cash",
  SSLCOMMERZ: "gateway",
  AAMARPAY: "gateway",
  SHURJOPAY: "gateway",
  STRIPE: "gateway",
  PAYPAL: "gateway",
  MANUAL_MOBILE_BANKING: "other",
  ROCKET: "other",
  UPAY: "other",
};

/** Statuses whose money has actually left the shop. */
const SENT_STATUSES = ["SENT", "CONFIRMED", "COMPLETED"] as const;

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export type RefundErrorCode =
  | "ORDER_NOT_FOUND"
  | "REFUND_NOT_FOUND"
  | "INVALID_INPUT"
  | "REASON_REQUIRED"
  | "OVER_REFUND"
  | "REFERENCE_REQUIRED"
  | "INVALID_TRANSITION";

export type RefundResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: RefundErrorCode; error: string };

const fail = (code: RefundErrorCode, error: string): { ok: false; code: RefundErrorCode; error: string } => ({
  ok: false,
  code,
  error,
});

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export interface RefundView {
  id: string;
  orderId: string;
  paymentId: string | null;
  amountPoisha: number;
  /** Workbench channel vocabulary (bkash | nagad | bank | cash | gateway | other). */
  method: RefundMethod;
  reference: string | null;
  reason: string;
  status: string;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RefundSummary {
  /** Σ Payment.paidPoisha + Σ APPROVED manual-Trx amounts. */
  grossPaidPoisha: number;
  /** Money refunded and not clawed back by a later cancel: gross − sent. */
  netPaidPoisha: number;
  /** Money actually sent back (SENT / CONFIRMED / COMPLETED rows). */
  refundedPoisha: number;
  /** Recorded but not yet sent (PENDING rows). */
  pendingRefundPoisha: number;
  /** Still refundable: gross − (sent + pending). The create cap. */
  refundablePoisha: number;
  /**
   * Owed back to the customer and not yet covered by any live refund
   * record — only for CANCELLED / RETURNED / REFUNDED orders; 0 for
   * orders still in the normal flow. Drives the workbench banner.
   */
  refundDuePoisha: number;
}

interface RefundRow {
  id: string;
  orderId: string;
  paymentId: string | null;
  amountPoisha: number;
  reason: string;
  method: string;
  payoutMethod: string | null;
  reference: string | null;
  status: string;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toView(row: RefundRow, actorNames: Map<string, string>): RefundView {
  const method =
    (row.payoutMethod as RefundMethod | null) ?? ENUM_TO_METHOD[row.method] ?? "other";
  return {
    id: row.id,
    orderId: row.orderId,
    paymentId: row.paymentId,
    amountPoisha: row.amountPoisha,
    method: (REFUND_METHODS as readonly string[]).includes(method) ? method : "other",
    reference: row.reference,
    reason: row.reason,
    status: row.status,
    createdById: row.createdById,
    createdByName: row.createdById ? (actorNames.get(row.createdById) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function actorNameMap(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === "string"))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.flatMap((u) => (u.name ? [[u.id, u.name] as const] : [])));
}

/* ------------------------------------------------------------------ */
/* Money math                                                          */
/* ------------------------------------------------------------------ */

interface MoneyFacts {
  orderId: string;
  orderStatus: string;
  grossPaidPoisha: number;
  sentPoisha: number;
  pendingPoisha: number;
}

/**
 * The one place refund totals are computed. Runs inside the caller's
 * transaction when given one so the create cap cannot race.
 */
async function moneyFacts(
  orderId: string,
  orderStatus: string,
  db: Pick<typeof prisma, "payment" | "manualTrxSubmission" | "refund"> = prisma,
): Promise<MoneyFacts> {
  const [paymentAgg, manualAgg, sentAgg, pendingAgg] = await Promise.all([
    db.payment.aggregate({
      where: { orderId, deletedAt: null },
      _sum: { paidPoisha: true },
    }),
    db.manualTrxSubmission.aggregate({
      where: { orderId, status: "APPROVED" },
      _sum: { amountPoisha: true },
    }),
    db.refund.aggregate({
      where: { orderId, status: { in: [...SENT_STATUSES] } },
      _sum: { amountPoisha: true },
    }),
    db.refund.aggregate({
      where: { orderId, status: "PENDING" },
      _sum: { amountPoisha: true },
    }),
  ]);
  return {
    orderId,
    orderStatus,
    grossPaidPoisha: (paymentAgg._sum.paidPoisha ?? 0) + (manualAgg._sum.amountPoisha ?? 0),
    sentPoisha: sentAgg._sum.amountPoisha ?? 0,
    pendingPoisha: pendingAgg._sum.amountPoisha ?? 0,
  };
}

function toSummary(facts: MoneyFacts): RefundSummary {
  const committed = facts.sentPoisha + facts.pendingPoisha;
  const refundable = Math.max(0, facts.grossPaidPoisha - committed);
  const dueApplies = ["CANCELLED", "RETURNED", "REFUNDED"].includes(facts.orderStatus);
  return {
    grossPaidPoisha: facts.grossPaidPoisha,
    netPaidPoisha: facts.grossPaidPoisha - facts.sentPoisha,
    refundedPoisha: facts.sentPoisha,
    pendingRefundPoisha: facts.pendingPoisha,
    refundablePoisha: refundable,
    refundDuePoisha: dueApplies ? refundable : 0,
  };
}

/** Resolve an order by id OR order number (same convention as the funnel). */
async function resolveOrder(orderRef: string) {
  return prisma.order.findFirst({
    where: { deletedAt: null, OR: [{ id: orderRef }, { orderNo: orderRef }] },
    select: { id: true, status: true },
  });
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function listRefunds(
  orderRef: string,
): Promise<RefundResult<{ refunds: RefundView[]; summary: RefundSummary }>> {
  const order = await resolveOrder(orderRef);
  if (!order) return fail("ORDER_NOT_FOUND", "Order not found. / অর্ডার পাওয়া যায়নি।");
  const rows = await prisma.refund.findMany({
    where: { orderId: order.id },
    orderBy: { createdAt: "desc" },
  });
  const names = await actorNameMap(rows.map((r) => r.createdById));
  const facts = await moneyFacts(order.id, order.status);
  return {
    ok: true,
    value: {
      refunds: rows.map((r) => toView(r, names)),
      summary: toSummary(facts),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export interface CreateRefundInput {
  amountPoisha: number;
  method: RefundMethod;
  reference?: string | null;
  reason: string;
}

export async function createRefund(
  orderRef: string,
  input: CreateRefundInput,
  actorId: string,
): Promise<RefundResult<{ refund: RefundView; summary: RefundSummary }>> {
  if (!Number.isInteger(input.amountPoisha) || input.amountPoisha <= 0) {
    return fail("INVALID_INPUT", "Refund amount must be a positive integer (poisha). / রিফান্ডের পরিমাণ ধনাত্মক হতে হবে।");
  }
  if (!(REFUND_METHODS as readonly string[]).includes(input.method)) {
    return fail("INVALID_INPUT", `Refund method must be one of: ${REFUND_METHODS.join(", ")}. / রিফান্ডের মাধ্যম সঠিক নয়।`);
  }
  const reason = input.reason?.trim() ?? "";
  if (!reason) {
    return fail("REASON_REQUIRED", "A reason is required for every refund. / রিফান্ডের কারণ আবশ্যক।");
  }
  const order = await resolveOrder(orderRef);
  if (!order) return fail("ORDER_NOT_FOUND", "Order not found. / অর্ডার পাওয়া যায়নি।");

  // Cap check + insert in ONE transaction. The order row is locked
  // FOR UPDATE first, which serialises refund creates per order — under
  // plain Read Committed two concurrent creates could both pass the
  // aggregate cap check before either commits.
  type CreateRefundTxResult =
    | { row: RefundRow; summary: RefundSummary }
    | { error: { refundable: number } };
  const created = (await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
    const facts = await moneyFacts(order.id, order.status, tx);
    const refundable = facts.grossPaidPoisha - facts.sentPoisha - facts.pendingPoisha;
    if (input.amountPoisha > refundable) {
      return { error: { refundable } } as const;
    }
    // Anchor to a Payment row when one genuinely carries this order's
    // money (gateway/COD collections); otherwise the refund anchors to
    // the order alone (paymentId stays null) — approved manual-TrxID
    // money lives on the submission rows, not on a Payment.
    const anchor =
      (await tx.payment.findFirst({
        where: { orderId: order.id, deletedAt: null, paidPoisha: { gt: 0 } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })) ??
      (await tx.manualTrxSubmission.findFirst({
        where: { orderId: order.id, status: "APPROVED", paymentId: { not: null } },
        orderBy: { submittedAt: "desc" },
        select: { paymentId: true },
      }));
    const paymentId = anchor ? ("id" in anchor ? anchor.id : anchor.paymentId) : null;
    const row = await tx.refund.create({
      data: {
        orderId: order.id,
        paymentId,
        amountPoisha: input.amountPoisha,
        reason,
        method: METHOD_ENUM[input.method],
        payoutMethod: input.method,
        reference: input.reference?.trim() ? input.reference.trim() : null,
        status: "PENDING",
        createdById: actorId,
      },
    });
    const after = await moneyFacts(order.id, order.status, tx);
    return { row, summary: toSummary(after) } as const;
  })) as CreateRefundTxResult;

  if ("error" in created) {
    return fail(
      "OVER_REFUND",
      `Refund exceeds the refundable balance (${created.error.refundable} poisha). / ফেরতযোগ্য ব্যালান্সের বেশি রিফান্ড করা যাবে না।`,
    );
  }

  await writeAudit({
    actorId,
    action: "orders.refund",
    entityType: "Refund",
    entityId: created.row.id,
    beforeJson: null,
    afterJson: {
      orderId: order.id,
      amountPoisha: created.row.amountPoisha,
      method: input.method,
      reference: created.row.reference,
      status: "PENDING",
    },
    reason,
  });

  const names = await actorNameMap([created.row.createdById]);
  return { ok: true, value: { refund: toView(created.row, names), summary: created.summary } };
}

/* ------------------------------------------------------------------ */
/* Status lifecycle                                                    */
/* ------------------------------------------------------------------ */

export interface UpdateRefundStatusInput {
  to: RefundStatus;
  /** Payout TrxID — required when marking SENT (stored on the row). */
  reference?: string | null;
  /** Audit reason; defaults to the refund's recorded reason. */
  reason?: string;
}

export async function updateRefundStatus(
  refundId: string,
  input: UpdateRefundStatusInput,
  actorId: string,
): Promise<RefundResult<{ refund: RefundView; summary: RefundSummary; paymentStatus: string | null }>> {
  const row = await prisma.refund.findUnique({ where: { id: refundId } });
  if (!row) return fail("REFUND_NOT_FOUND", "Refund not found. / রিফান্ড পাওয়া যায়নি।");

  const allowed = TRANSITIONS[row.status] ?? [];
  if (!allowed.includes(input.to)) {
    return fail(
      "INVALID_TRANSITION",
      `Refund in status ${row.status} cannot move to ${input.to}. / ${row.status} অবস্থা থেকে ${input.to} করা যাবে না।`,
    );
  }

  const reference = input.reference?.trim() ? input.reference.trim() : row.reference;
  if (input.to === "SENT" && !reference) {
    return fail(
      "REFERENCE_REQUIRED",
      "A payout reference (e.g. bKash TrxID) is required before marking a refund SENT. / পাঠানো হয়েছে করতে পেআউট রেফারেন্স (TrxID) আবশ্যক।",
    );
  }

  const updated = await prisma.refund.update({
    where: { id: refundId },
    data: { status: input.to, reference },
  });

  // Money actually moved ⇒ recompute the order's payment status from
  // rows through the single funnel (never set it by hand here).
  let paymentStatus: string | null = null;
  if (input.to === "SENT") {
    const result = await markOrderPayment(row.orderId, {
      source: "refund_workbench",
      reference: refundId,
    });
    paymentStatus = result?.paymentStatus ?? null;
  }

  await writeAudit({
    actorId,
    action: "orders.refund",
    entityType: "Refund",
    entityId: refundId,
    beforeJson: { status: row.status, reference: row.reference },
    afterJson: { status: updated.status, reference: updated.reference },
    reason: input.reason?.trim() ? input.reason.trim() : row.reason,
  });

  const order = await prisma.order.findUnique({
    where: { id: row.orderId },
    select: { status: true },
  });
  const facts = await moneyFacts(row.orderId, order?.status ?? "");
  const names = await actorNameMap([updated.createdById]);
  return {
    ok: true,
    value: { refund: toView(updated, names), summary: toSummary(facts), paymentStatus },
  };
}
