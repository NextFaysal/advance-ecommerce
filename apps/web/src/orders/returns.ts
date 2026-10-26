/**
 * Returns / RMA — doc 17 batch O7 (wave 25). The FIRST writers of the
 * Return model: before this module the schema had a Return table with
 * zero writers, no per-line items, and no restock path at all — a
 * "returned" order kept its loyalty/reseller/vendor credits reversed
 * by the O0 engine but the physical goods and the customer's money had
 * no in-system flow. This service is that flow.
 *
 * LIFECYCLE (ReturnStatus values added by migration
 * 20261025203000_returns_rma_flow; the legacy enum values RETURNING /
 * RETURNED / REFUNDED / EXCHANGED predate the flow and are unused):
 *
 *   REQUESTED ──► APPROVED ──► RECEIVED ──► COMPLETED
 *       │                        │
 *       └──► REJECTED            └──► CLOSED
 *        (reason required)        (no refund — see below)
 *
 * RULES, exactly as implemented:
 *  - Create: the order must be in status DELIVERED. Split-shipment
 *    orders are DELIVERED only once every parcel landed (O5 rule), so
 *    status DELIVERED means every line is in the customer's hands;
 *    anything else (incl. RETURN_REQUESTED / RETURNING from the legacy
 *    next-step button) is refused with ORDER_NOT_DELIVERED.
 *  - Quantities: per line, qty ≥ 1 and ≤ ordered − already-returned,
 *    where already-returned counts ReturnItems on returns in
 *    RECEIVED / COMPLETED / CLOSED (goods physically back) plus the
 *    legacy RETURNING / RETURNED / REFUNDED statuses. A line that
 *    already sits on an OPEN return (REQUESTED / APPROVED) refuses a
 *    second one outright (DUPLICATE_OPEN_RETURN) — staff finish or
 *    reject the open one first.
 *  - Receive: staff record a condition per line. RESTOCKABLE lines go
 *    back on the shelf IN THIS STEP's transaction (variant stock
 *    increment + RETURN_RESTOCK StockMovement + InventoryItem mirror,
 *    the reservation ledger's shape). DAMAGED lines never touch stock.
 *  - Complete: creates exactly ONE PENDING refund in the refund
 *    workbench (src/orders/refunds.ts — the only money path) for the
 *    goods value of the RESTOCKABLE received lines (unitPricePoisha ×
 *    qty snapshots; shipping is never refunded by a return, and an
 *    order-level discount is not prorated — the workbench's
 *    gross-paid cap is the final guard). DAMAGED lines are refunded
 *    0. A return whose received lines are ALL damaged has nothing to
 *    complete: it must be CLOSED instead (no refund record at all).
 *    If the workbench refuses (e.g. no paid money recorded for the
 *    order — an unpaid COD delivery), completion fails with
 *    REFUND_NOT_POSSIBLE and the return stays RECEIVED; staff record
 *    the payment first. Money NEVER moves here: the refund stays
 *    PENDING until staff send it and mark SENT in the workbench.
 *  - Full return: when a completion (or close) leaves EVERY order
 *    line fully returned, the ORDER walks DELIVERED →
 *    RETURN_REQUESTED → RETURNING → RETURNED through
 *    applyOrderTransition, so the O0 reversal engine (loyalty,
 *    reseller wallet, vendor commission) fires exactly once on the
 *    RETURNED step. A PARTIAL return never moves the order — it stays
 *    DELIVERED with a timeline note, and no reversal fires for goods
 *    the customer kept.
 *  - Idempotency: completing a COMPLETED return returns its recorded
 *    state (refundId included) without creating a second refund; the
 *    RECEIVED → COMPLETED flip is a guarded updateMany so a racing
 *    second completion cannot slip a second refund past the check.
 *
 * Every step writes an `orders.return` audit row and a bilingual
 * OrderNote (the order timeline), matching the refunds workbench's
 * audit discipline.
 *
 * SHARED CONTRACT: createReturn below is the exact signature O7-2
 * (customer self-service + exchanges) builds against. It THROWS
 * ReturnServiceError (carrying a bilingual message + code) on any
 * validation failure; the lifecycle helpers return ReturnResult
 * instead, for the admin routes.
 */
import { prisma } from "@advance-ecommerce/db";
import { maskPhone } from "@advance-ecommerce/validators";
import { writeAudit } from "@/lib/audit";
import { notifyBackInStockForVariant } from "../storefront-ux/back-in-stock-notify";
import { applyOrderTransition } from "./repository";
import { createRefund, type RefundMethod } from "./refunds";
import {
  addQty,
  cmpQty,
  isValidQtyNumber,
  lineTotalPoisha,
  qtyNumber,
  qtyToDecimalString,
  qtyToString,
  stockClaimUnits,
  subQty,
} from "../lib/quantity";

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

export const RETURN_STATUSES = [
  "REQUESTED",
  "APPROVED",
  "REJECTED",
  "RECEIVED",
  "COMPLETED",
  "CLOSED",
] as const;
export type ReturnStatusValue = (typeof RETURN_STATUSES)[number];

/** Statuses whose goods count as "already returned" for a line —
 *  the goods are physically back (or, for the legacy enum values,
 *  were treated as back before this flow existed). */
const RETURNED_COUNT_STATUSES = [
  "RECEIVED",
  "COMPLETED",
  "CLOSED",
  "RETURNING",
  "RETURNED",
  "REFUNDED",
] as const;

/** Statuses that block a second return for the same line. */
const OPEN_STATUSES = ["REQUESTED", "APPROVED"] as const;

export type ReturnLineCondition = "restockable" | "damaged";

const CONDITION_TO_DB: Record<ReturnLineCondition, "RESTOCKABLE" | "DAMAGED"> = {
  restockable: "RESTOCKABLE",
  damaged: "DAMAGED",
};

/** The workbench channel a completion refund is recorded under,
 *  derived from how the order was paid. Staff pick the real payout
 *  channel when they mark the refund SENT; this is the honest
 *  default (money goes back the way it came). */
const ORDER_METHOD_TO_REFUND_METHOD: Record<string, RefundMethod> = {
  BKASH: "bkash",
  NAGAD: "nagad",
  COD: "cash",
  SSLCOMMERZ: "gateway",
  AAMARPAY: "gateway",
  SHURJOPAY: "gateway",
  STRIPE: "gateway",
  PAYPAL: "gateway",
  MANUAL_MOBILE_BANKING: "bank",
  ROCKET: "other",
  UPAY: "other",
};

/* ------------------------------------------------------------------ */
/* Errors / results                                                    */
/* ------------------------------------------------------------------ */

export type ReturnErrorCode =
  | "ORDER_NOT_FOUND"
  | "RETURN_NOT_FOUND"
  | "ORDER_NOT_DELIVERED"
  | "INVALID_INPUT"
  | "LINE_NOT_IN_ORDER"
  | "INVALID_QUANTITY"
  | "QUANTITY_EXCEEDED"
  | "DUPLICATE_OPEN_RETURN"
  | "REASON_REQUIRED"
  | "INVALID_TRANSITION"
  | "CONDITIONS_INCOMPLETE"
  | "NO_REFUNDABLE_LINES"
  | "REFUND_NOT_POSSIBLE";

export class ReturnServiceError extends Error {
  readonly code: ReturnErrorCode;
  constructor(code: ReturnErrorCode, message: string) {
    super(message);
    this.name = "ReturnServiceError";
    this.code = code;
  }
}

export type ReturnResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ReturnErrorCode; error: string };

const fail = (code: ReturnErrorCode, error: string): { ok: false; code: ReturnErrorCode; error: string } => ({
  ok: false,
  code,
  error,
});

function asResult<T>(run: () => Promise<T>): Promise<ReturnResult<T>> {
  return run().then(
    (value) => ({ ok: true as const, value }),
    (err: unknown) => {
      if (err instanceof ReturnServiceError) return fail(err.code, err.message);
      throw err;
    },
  );
}

/** Who is acting: `id` is the staff User id when known (audit +
 *  note author), `label` is the free-form actor label stored on the
 *  return row at create (admin route passes the user id; the
 *  customer flow passes "customer:<id>"). */
export interface ReturnActor {
  id: string | null;
  label: string;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export interface ReturnItemView {
  id: string;
  orderItemId: string;
  productName: string;
  sku: string;
  unitPricePoisha: number;
  orderedQuantity: number;
  quantity: number;
  reason: string | null;
  condition: ReturnLineCondition | null;
  lineValuePoisha: number;
}

export interface ReturnView {
  id: string;
  orderId: string;
  orderNo: string;
  customerName: string;
  customerPhoneMasked: string;
  type: string;
  source: string;
  status: string;
  reason: string;
  customerNote: string | null;
  decisionReason: string | null;
  qcNote: string | null;
  restockDecision: string | null;
  refundId: string | null;
  actorLabel: string | null;
  items: ReturnItemView[];
  /** Σ unit price × qty over ALL lines. */
  goodsValuePoisha: number;
  /** Σ over RESTOCKABLE lines once received; before receive, the
   *  potential refund = the full goods value. */
  refundableValuePoisha: number;
  createdAt: string;
  updatedAt: string;
}

type ReturnRow = Awaited<ReturnType<typeof loadReturnRow>>;
async function loadReturnRow(id: string) {
  return prisma.return.findFirst({
    where: { id, deletedAt: null },
    include: {
      order: {
        select: { id: true, orderNo: true, customerName: true, customerPhone: true, status: true, paymentMethod: true },
      },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          orderItem: {
            select: { id: true, productName: true, sku: true, unitPricePoisha: true, quantity: true, variantId: true },
          },
        },
      },
    },
  });
}

function toView(row: NonNullable<ReturnRow>): ReturnView {
  const items: ReturnItemView[] = row.items.map((it) => ({
    id: it.id,
    orderItemId: it.orderItemId,
    productName: it.orderItem.productName,
    sku: it.orderItem.sku,
    unitPricePoisha: it.orderItem.unitPricePoisha,
    // Wave 59: both quantities are Decimal columns now — canonicalise
    // to milli-exact numbers; the line value uses the single
    // line-level rounding rule.
    orderedQuantity: qtyNumber(it.orderItem.quantity),
    quantity: qtyNumber(it.quantity),
    reason: it.reason,
    condition:
      it.condition === "RESTOCKABLE" ? "restockable" : it.condition === "DAMAGED" ? "damaged" : null,
    lineValuePoisha: lineTotalPoisha(it.orderItem.unitPricePoisha, it.quantity),
  }));
  const received = items.some((i) => i.condition !== null);
  return {
    id: row.id,
    orderId: row.orderId,
    orderNo: row.order.orderNo,
    customerName: row.order.customerName,
    customerPhoneMasked: maskPhone(row.order.customerPhone),
    type: row.type,
    source: row.source,
    status: row.status,
    reason: row.reason,
    customerNote: row.customerNote,
    decisionReason: row.decisionReason,
    qcNote: row.qcNote,
    restockDecision: row.restockDecision,
    refundId: row.refundId,
    actorLabel: row.actorLabel,
    items,
    goodsValuePoisha: items.reduce((s, i) => s + i.lineValuePoisha, 0),
    refundableValuePoisha: received
      ? items.filter((i) => i.condition === "restockable").reduce((s, i) => s + i.lineValuePoisha, 0)
      : items.reduce((s, i) => s + i.lineValuePoisha, 0),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Resolve an order by id OR order number (the refunds convention). */
async function resolveOrder(orderRef: string) {
  return prisma.order.findFirst({
    where: { deletedAt: null, OR: [{ id: orderRef }, { orderNo: orderRef }] },
    select: { id: true, orderNo: true, status: true, paymentMethod: true },
  });
}

/** Resolve a label to a User id when it is one (repository pattern —
 *  note/audit FK columns persist NULL for free-text actors). */
async function resolveUserId(label: string | null | undefined): Promise<string | null> {
  if (!label) return null;
  const user = await prisma.user.findUnique({ where: { id: label }, select: { id: true } });
  return user?.id ?? null;
}

async function addOrderNote(orderId: string, authorId: string | null, text: string): Promise<void> {
  await prisma.orderNote.create({ data: { orderId, authorId, text } });
}

async function auditReturn(
  actor: ReturnActor,
  returnId: string,
  orderId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  reason?: string,
): Promise<void> {
  await writeAudit({
    actorId: actor.id ?? (await resolveUserId(actor.label)),
    action: "orders.return",
    entityType: "Return",
    entityId: returnId,
    beforeJson: before,
    afterJson: { orderId, ...(after ?? {}) },
    reason,
  });
}

/** Σ already-returned quantity per orderItemId for an order. */
async function returnedQuantities(orderId: string): Promise<Map<string, number>> {
  const rows = await prisma.returnItem.findMany({
    where: {
      return: { orderId, deletedAt: null, status: { in: [...RETURNED_COUNT_STATUSES] } },
    },
    select: { orderItemId: true, quantity: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.orderItemId, addQty(map.get(r.orderItemId) ?? 0, r.quantity));
  return map;
}

/** True when every line of the order is fully covered by returns
 *  whose goods are physically back (RECEIVED / COMPLETED / CLOSED). */
async function isOrderFullyReturned(orderId: string): Promise<boolean> {
  const [lines, covered] = await Promise.all([
    prisma.orderItem.findMany({ where: { orderId }, select: { id: true, quantity: true } }),
    returnedQuantities(orderId),
  ]);
  if (lines.length === 0) return false;
  return lines.every((l) => cmpQty(covered.get(l.id) ?? 0, l.quantity) >= 0);
}

/**
 * After a completion/close, if the order is now fully returned, walk
 * it to RETURNED through the funnel so reversals fire exactly once.
 * Best-effort by design (the return itself already committed): a
 * failure is logged and reported, never thrown into the caller.
 */
async function maybeTransitionOrderToReturned(
  orderId: string,
  actor: ReturnActor,
): Promise<{ transitioned: boolean; note?: string }> {
  try {
    if (!(await isOrderFullyReturned(orderId))) return { transitioned: false };
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
    if (!order) return { transitioned: false };
    if (order.status === "RETURNED") return { transitioned: false, note: "already_returned" };
    const path = ["RETURN_REQUESTED", "RETURNING", "RETURNED"] as const;
    const startAt = path.indexOf(order.status as (typeof path)[number]);
    if (order.status !== "DELIVERED" && startAt === -1) {
      return { transitioned: false, note: `order_in_status_${order.status}` };
    }
    const steps = order.status === "DELIVERED" ? path : path.slice(startAt + 1);
    const changedBy = actor.id ?? "system";
    for (const to of steps) {
      const result = await applyOrderTransition(
        orderId,
        to,
        changedBy,
        "সব পণ্য রিটার্ন সম্পন্ন হয়েছে (RMA) / All items returned — RMA complete",
      );
      if (result.kind !== "ok") {
        console.error(`[returns] order ${orderId} funnel step to ${to} failed:`, result);
        return { transitioned: false, note: `funnel_step_${to}_failed` };
      }
    }
    return { transitioned: true };
  } catch (err) {
    console.error(`[returns] order ${orderId} RETURNED walk failed:`, err);
    return { transitioned: false, note: "funnel_error" };
  }
}

/* ------------------------------------------------------------------ */
/* Create — the shared O7 contract                                     */
/* ------------------------------------------------------------------ */

export interface CreateReturnInput {
  orderId: string;
  items: { orderItemId: string; quantity: number; reason?: string }[];
  source: "admin" | "customer";
  actorLabel: string;
  customerNote?: string;
}

/**
 * Create a return in REQUESTED. Throws ReturnServiceError on any
 * validation failure (bilingual message, machine-readable code).
 * Duplicate lines in one request are merged. Writes the Return +
 * ReturnItem rows in one transaction, then the audit row and the
 * order timeline note.
 */
export async function createReturn(input: CreateReturnInput): Promise<{ returnId: string; status: string }> {
  const order = await resolveOrder(input.orderId);
  if (!order) {
    throw new ReturnServiceError("ORDER_NOT_FOUND", "Order not found. / অর্ডার পাওয়া যায়নি।");
  }
  if (order.status !== "DELIVERED") {
    throw new ReturnServiceError(
      "ORDER_NOT_DELIVERED",
      `Returns can only be created for DELIVERED orders; this order is ${order.status}. / শুধু ডেলিভারি সম্পন্ন অর্ডারেই রিটার্ন করা যায়; এই অর্ডারের অবস্থা ${order.status}।`,
    );
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new ReturnServiceError("INVALID_INPUT", "A return needs at least one item. / রিটার্নে অন্তত একটি পণ্য থাকতে হবে।");
  }
  // Merge duplicate lines (a form posting the same line twice is one
  // request for the summed quantity, never two rows).
  const merged = new Map<string, { quantity: number; reason?: string }>();
  for (const raw of input.items) {
    if (!raw || typeof raw.orderItemId !== "string" || raw.orderItemId.length === 0) {
      throw new ReturnServiceError("INVALID_INPUT", "Every return line needs an order item id. / প্রতিটি লাইনে অর্ডার আইটেমের আইডি আবশ্যক।");
    }
    // Wave 59: fractional lines may be returned in fractions (to 3
    // decimals) — the quantity just has to be exactly representable.
    if (!isValidQtyNumber(raw.quantity)) {
      throw new ReturnServiceError(
        "INVALID_QUANTITY",
        "Return quantity must be positive with at most 3 decimal places. / রিটার্নের পরিমাণ ধনাত্মক হতে হবে (সর্বোচ্চ ৩ দশমিক)।",
      );
    }
    const prev = merged.get(raw.orderItemId);
    merged.set(raw.orderItemId, {
      quantity: addQty(prev?.quantity ?? 0, raw.quantity),
      reason: raw.reason?.trim() ? raw.reason.trim() : prev?.reason,
    });
  }

  const orderItems = await prisma.orderItem.findMany({
    where: { orderId: order.id },
    select: { id: true, productName: true, sku: true, quantity: true },
  });
  const byId = new Map(orderItems.map((i) => [i.id, i]));
  for (const orderItemId of merged.keys()) {
    if (!byId.has(orderItemId)) {
      throw new ReturnServiceError(
        "LINE_NOT_IN_ORDER",
        `Order item ${orderItemId} does not belong to order ${order.orderNo}. / আইটেমটি এই অর্ডারের নয়।`,
      );
    }
  }

  // One open return per line: an undecided / approved return already
  // covering a requested line blocks a second one.
  const openLines = await prisma.returnItem.findMany({
    where: {
      orderItemId: { in: [...merged.keys()] },
      return: { orderId: order.id, deletedAt: null, status: { in: [...OPEN_STATUSES] } },
    },
    select: { orderItemId: true },
  });
  if (openLines.length > 0) {
    throw new ReturnServiceError(
      "DUPLICATE_OPEN_RETURN",
      "One of these items is already on an open return — finish or reject that return first. / এই পণ্যের একটি রিটার্ন ইতিমধ্যে চলমান আছে — আগে সেটি শেষ করুন বা বাতিল করুন।",
    );
  }

  const returned = await returnedQuantities(order.id);
  for (const [orderItemId, line] of merged) {
    const item = byId.get(orderItemId)!;
    const remaining = subQty(item.quantity, returned.get(orderItemId) ?? 0);
    if (cmpQty(line.quantity, remaining) > 0) {
      throw new ReturnServiceError(
        "QUANTITY_EXCEEDED",
        `Cannot return ${qtyToString(line.quantity)} × ${item.productName} (${item.sku}): only ${qtyToString(remaining)} of ${qtyToString(item.quantity)} ordered remain returnable. / ${item.productName}: অর্ডার করা ${qtyToString(item.quantity)}টির মধ্যে আর মাত্র ${qtyToString(remaining)}টি ফেরতযোগ্য আছে।`,
      );
    }
  }

  // The legacy Return.reason column is required: compose it from the
  // first line reason, else the requester's note, else a default.
  const composedReason =
    [...merged.values()].find((l) => l.reason)?.reason ??
    (input.customerNote?.trim() ? input.customerNote.trim() : null) ??
    "Return requested / রিটার্নের অনুরোধ করা হয়েছে";

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.return.create({
      data: {
        orderId: order.id,
        type: "RETURN",
        reason: composedReason,
        status: "REQUESTED",
        source: input.source,
        customerNote: input.customerNote?.trim() ? input.customerNote.trim() : null,
        actorLabel: input.actorLabel,
      },
    });
    for (const [orderItemId, line] of merged) {
      await tx.returnItem.create({
        data: {
          returnId: row.id,
          orderItemId,
          // Decimal(12, 3) column — canonical string, never a float.
          quantity: qtyToDecimalString(line.quantity),
          reason: line.reason ?? null,
        },
      });
    }
    return row;
  });

  const actor: ReturnActor = { id: await resolveUserId(input.actorLabel), label: input.actorLabel };
  const lineSummary = [...merged.entries()]
    .map(([id, l]) => `${byId.get(id)!.productName} ×${qtyToString(l.quantity)}`)
    .join(", ");
  await addOrderNote(
    order.id,
    actor.id,
    `রিটার্নের অনুরোধ তৈরি হয়েছে (${input.source === "customer" ? "কাস্টমার" : "অ্যাডমিন"}): ${lineSummary}। কারণ: ${composedReason} / Return requested: ${lineSummary}. Reason: ${composedReason}`,
  );
  await auditReturn(actor, created.id, order.id, null, {
    status: "REQUESTED",
    source: input.source,
    items: [...merged.entries()].map(([orderItemId, l]) => ({ orderItemId, quantity: l.quantity })),
  }, composedReason);

  return { returnId: created.id, status: created.status };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function getReturn(returnId: string): Promise<ReturnResult<ReturnView>> {
  const row = await loadReturnRow(returnId);
  if (!row) return fail("RETURN_NOT_FOUND", "Return not found. / রিটার্ন পাওয়া যায়নি।");
  return { ok: true, value: toView(row) };
}

export async function listReturnsForOrder(orderRef: string): Promise<ReturnResult<ReturnView[]>> {
  const order = await resolveOrder(orderRef);
  if (!order) return fail("ORDER_NOT_FOUND", "Order not found. / অর্ডার পাওয়া যায়নি।");
  const rows = await prisma.return.findMany({
    where: { orderId: order.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const views: ReturnView[] = [];
  for (const r of rows) {
    const full = await loadReturnRow(r.id);
    if (full) views.push(toView(full));
  }
  return { ok: true, value: views };
}

/** Queue read for /admin/returns — status filter + pagination in the
 *  list-v2 shape ({ returns, total, counts } where counts ignore the
 *  status filter so the chips stay meaningful). */
export async function listReturns(input: {
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<ReturnResult<{ returns: ReturnView[]; total: number; counts: Record<string, number> }>> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 25)));
  if (input.status && !(RETURN_STATUSES as readonly string[]).includes(input.status)) {
    return fail("INVALID_INPUT", `Unknown return status: ${input.status}. / অজানা রিটার্ন অবস্থা।`);
  }
  const where = {
    deletedAt: null,
    ...(input.status ? { status: input.status as ReturnStatusValue } : {}),
  };
  const [total, grouped, pageRows] = await Promise.all([
    prisma.return.count({ where }),
    prisma.return.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } }),
    prisma.return.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true },
    }),
  ]);
  const counts: Record<string, number> = { ALL: 0 };
  for (const s of RETURN_STATUSES) counts[s] = 0;
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    counts.ALL += g._count._all;
  }
  const views: ReturnView[] = [];
  for (const r of pageRows) {
    const full = await loadReturnRow(r.id);
    if (full) views.push(toView(full));
  }
  return { ok: true, value: { returns: views, total, counts } };
}

/** Minimal order context for the returns panel header (status gates
 *  the create form: only DELIVERED orders can take a return). */
export async function getOrderReturnContext(
  orderRef: string,
): Promise<{ orderId: string; orderNo: string; status: string } | null> {
  const order = await resolveOrder(orderRef);
  if (!order) return null;
  return { orderId: order.id, orderNo: order.orderNo, status: order.status };
}

/** Per-line returnable state for an order (the returns panel form):
 *  ordered qty, already-returned qty, whether an open return holds
 *  the line, and the remaining returnable qty. */
export async function getOrderReturnableLines(orderRef: string): Promise<
  ReturnResult<
    {
      orderItemId: string;
      productName: string;
      sku: string;
      unitPricePoisha: number;
      orderedQuantity: number;
      returnedQuantity: number;
      openReturn: boolean;
      returnableQuantity: number;
    }[]
  >
> {
  const order = await resolveOrder(orderRef);
  if (!order) return fail("ORDER_NOT_FOUND", "Order not found. / অর্ডার পাওয়া যায়নি।");
  const [items, returned, open] = await Promise.all([
    prisma.orderItem.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, productName: true, sku: true, unitPricePoisha: true, quantity: true },
    }),
    returnedQuantities(order.id),
    prisma.returnItem.findMany({
      where: { return: { orderId: order.id, deletedAt: null, status: { in: [...OPEN_STATUSES] } } },
      select: { orderItemId: true },
    }),
  ]);
  const openSet = new Set(open.map((o) => o.orderItemId));
  return {
    ok: true,
    value: items.map((i) => {
      const done = returned.get(i.id) ?? 0;
      return {
        orderItemId: i.id,
        productName: i.productName,
        sku: i.sku,
        unitPricePoisha: i.unitPricePoisha,
        orderedQuantity: qtyNumber(i.quantity),
        returnedQuantity: done,
        openReturn: openSet.has(i.id),
        returnableQuantity: Math.max(0, subQty(i.quantity, done)),
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

async function loadForTransition(returnId: string): Promise<NonNullable<ReturnRow>> {
  const row = await loadReturnRow(returnId);
  if (!row) {
    throw new ReturnServiceError("RETURN_NOT_FOUND", "Return not found. / রিটার্ন পাওয়া যায়নি।");
  }
  return row;
}

function expectStatus(row: { status: string }, allowed: readonly string[], to: string): void {
  if (!allowed.includes(row.status)) {
    throw new ReturnServiceError(
      "INVALID_TRANSITION",
      `A return in status ${row.status} cannot move to ${to}. / ${row.status} অবস্থা থেকে ${to} করা যাবে না।`,
    );
  }
}

export async function approveReturn(
  returnId: string,
  actor: ReturnActor,
): Promise<ReturnResult<ReturnView>> {
  return asResult(async () => {
    const row = await loadForTransition(returnId);
    expectStatus(row, ["REQUESTED"], "APPROVED");
    await prisma.return.update({ where: { id: returnId }, data: { status: "APPROVED" } });
    await addOrderNote(
      row.orderId,
      actor.id,
      `রিটার্ন অনুমোদিত হয়েছে — পণ্য ফেরত পাঠাতে বলুন। / Return approved — ask the customer to send the items back.`,
    );
    await auditReturn(actor, returnId, row.orderId, { status: row.status }, { status: "APPROVED" });
    return toView((await loadReturnRow(returnId))!);
  });
}

export async function rejectReturn(
  returnId: string,
  actor: ReturnActor,
  reason: string,
): Promise<ReturnResult<ReturnView>> {
  return asResult(async () => {
    const trimmed = reason?.trim() ?? "";
    if (!trimmed) {
      throw new ReturnServiceError("REASON_REQUIRED", "A reason is required to reject a return. / রিটার্ন বাতিল করতে কারণ আবশ্যক।");
    }
    const row = await loadForTransition(returnId);
    expectStatus(row, ["REQUESTED"], "REJECTED");
    await prisma.return.update({
      where: { id: returnId },
      data: { status: "REJECTED", decisionReason: trimmed },
    });
    await addOrderNote(
      row.orderId,
      actor.id,
      `রিটার্ন বাতিল করা হয়েছে। কারণ: ${trimmed} / Return rejected. Reason: ${trimmed}`,
    );
    await auditReturn(actor, returnId, row.orderId, { status: row.status }, { status: "REJECTED" }, trimmed);
    return toView((await loadReturnRow(returnId))!);
  });
}

export interface ReceiveReturnInput {
  lineConditions: { orderItemId: string; condition: ReturnLineCondition }[];
  qcNote?: string;
}

/**
 * Receive the goods: stamp each line's condition and restock the
 * RESTOCKABLE lines in the SAME transaction (stock increment +
 * RETURN_RESTOCK movement + InventoryItem mirror). If no warehouse
 * exists the cache still moves and the movement is skipped with a
 * warning — the reservation code's ledgerPending precedent.
 */
export async function receiveReturn(
  returnId: string,
  actor: ReturnActor,
  input: ReceiveReturnInput,
): Promise<ReturnResult<ReturnView>> {
  return asResult(async () => {
    const row = await loadForTransition(returnId);
    expectStatus(row, ["APPROVED"], "RECEIVED");
    if (!Array.isArray(input.lineConditions) || input.lineConditions.length === 0) {
      throw new ReturnServiceError(
        "CONDITIONS_INCOMPLETE",
        "Every return line needs a condition (restockable / damaged) before receiving. / পণ্য বুঝে নিতে প্রতিটি লাইনের অবস্থা (ভালো / নষ্ট) আবশ্যক।",
      );
    }
    const conditionByItem = new Map<string, ReturnLineCondition>();
    for (const c of input.lineConditions) {
      if (!c || typeof c.orderItemId !== "string" || !(c.condition in CONDITION_TO_DB)) {
        throw new ReturnServiceError(
          "CONDITIONS_INCOMPLETE",
          "Every return line needs a condition (restockable / damaged) before receiving. / পণ্য বুঝে নিতে প্রতিটি লাইনের অবস্থা (ভালো / নষ্ট) আবশ্যক।",
        );
      }
      conditionByItem.set(c.orderItemId, c.condition);
    }
    for (const item of row.items) {
      if (!conditionByItem.has(item.orderItemId)) {
        throw new ReturnServiceError(
          "CONDITIONS_INCOMPLETE",
          `Missing a condition for ${item.orderItem.productName} (${item.orderItem.sku}). / ${item.orderItem.productName}-এর অবস্থা দেওয়া হয়নি।`,
        );
      }
    }

    let restockedUnits = 0;
    let damagedUnits = 0;
    const restockedVariantIds = new Set<string>();
    // ADV-20: per-variant returned quantities for the post-commit
    // serial flip (SOLD → IN_STOCK restockable, SOLD → RETURNED
    // damaged) in src/inventory/batches.ts.
    const restockQtyByVariant = new Map<string, number>();
    const damagedQtyByVariant = new Map<string, number>();
    await prisma.$transaction(async (tx) => {
      // Guarded status flip FIRST inside the tx: if a racing receive
      // already moved the return, abort before any stock moves (the
      // throw rolls the whole transaction back).
      const flipped = await tx.return.updateMany({
        where: { id: returnId, status: "APPROVED" },
        data: { status: "RECEIVED" },
      });
      if (flipped.count !== 1) {
        throw new ReturnServiceError(
          "INVALID_TRANSITION",
          "This return was already received. / এই রিটার্নের পণ্য ইতিমধ্যে বুঝে নেওয়া হয়েছে।",
        );
      }
      const warehouse = await tx.warehouse.findFirst({
        where: { deletedAt: null, isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      for (const item of row.items) {
        const condition = conditionByItem.get(item.orderItemId)!;
        await tx.returnItem.update({
          where: { id: item.id },
          data: { condition: CONDITION_TO_DB[condition] },
        });
        // Wave 59: the returned quantity is a Decimal (may be
        // fractional for weighted lines). Display counters keep the
        // true quantity; every STOCK movement uses whole units via
        // stockClaimUnits (ceil for fractions — symmetric with the
        // reservation claim the order placed).
        const returnedQty = qtyNumber(item.quantity);
        const stockUnits = stockClaimUnits(returnedQty);
        if (condition === "damaged") {
          damagedUnits = addQty(damagedUnits, returnedQty);
          damagedQtyByVariant.set(
            item.orderItem.variantId,
            (damagedQtyByVariant.get(item.orderItem.variantId) ?? 0) + stockUnits,
          );
          continue;
        }
        restockedUnits = addQty(restockedUnits, returnedQty);
        const variantId = item.orderItem.variantId;
        const restored = await tx.productVariant.updateMany({
          where: { id: variantId },
          data: { stock: { increment: stockUnits } },
        });
        if (restored.count !== 1) {
          console.warn(
            `[returns] restock for return ${returnId}: variant ${variantId} not found — stock not restored for ${qtyToString(returnedQty)} units.`,
          );
          continue;
        }
        restockedVariantIds.add(variantId);
        restockQtyByVariant.set(variantId, (restockQtyByVariant.get(variantId) ?? 0) + stockUnits);
        const afterRow = await tx.productVariant.findUnique({
          where: { id: variantId },
          select: { stock: true },
        });
        const after = afterRow?.stock ?? stockUnits;
        const before = after - stockUnits;
        if (!warehouse) {
          console.warn(
            `[returns] restock for return ${returnId}: no warehouse for the ledger movement (variant ${variantId}, qty ${qtyToString(returnedQty)}) — stock cache moved, movement skipped.`,
          );
          continue;
        }
        await tx.stockMovement.create({
          data: {
            variantId,
            warehouseId: warehouse.id,
            type: "RETURN_RESTOCK",
            quantityDelta: stockUnits,
            quantityBefore: before,
            quantityAfter: after,
            referenceType: "RETURN",
            referenceId: returnId,
            reason: `Return restock — return ${returnId}, order ${row.order.orderNo}`,
            actorId: actor.id,
          },
        });
        const inv = await tx.inventoryItem.findUnique({
          where: { variantId_warehouseId: { variantId, warehouseId: warehouse.id } },
          select: { quantityReserved: true },
        });
        await tx.inventoryItem.upsert({
          where: { variantId_warehouseId: { variantId, warehouseId: warehouse.id } },
          create: {
            variantId,
            warehouseId: warehouse.id,
            quantityOnHand: after,
            quantityReserved: 0,
          },
          update: {
            quantityOnHand: after,
            // The delivered order's reservation was terminal (never
            // committed), so the returned units also release their
            // reserved count — clamped at zero for safety.
            quantityReserved: Math.max(0, (inv?.quantityReserved ?? 0) - stockUnits),
          },
        });
      }
      await tx.return.update({
        where: { id: returnId },
        data: {
          qcNote: input.qcNote?.trim() ? input.qcNote.trim() : row.qcNote,
          restockDecision: `Restocked ${restockedUnits} unit(s); damaged ${damagedUnits} unit(s) kept out of stock. / ভালো ${restockedUnits}টি স্টকে ফিরেছে; নষ্ট ${damagedUnits}টি স্টকে যাবে না।`,
        },
      });
    });

    // Doc 21 G3-9: restocked units may have made a sold-out variant
    // available again — offer its pending back-in-stock signups a
    // notify job. Fire-and-forget AFTER the receive committed (the
    // producer itself re-checks the stock cache and never throws);
    // a queue failure must not fail a completed receive.
    for (const variantId of restockedVariantIds) {
      void notifyBackInStockForVariant(variantId).catch(() => undefined);
    }

    // ADV-20: flip this order's recorded serials back (restockable →
    // IN_STOCK, damaged → RETURNED). Fire-and-forget after commit,
    // same discipline as the notify above; the depth module self-gates
    // on module.inventory_depth and never throws.
    if (restockQtyByVariant.size > 0 || damagedQtyByVariant.size > 0) {
      void import("../inventory/batches")
        .then((m) =>
          m.restoreSerialsForReturnDepth({
            orderId: row.orderId,
            restockByVariant: restockQtyByVariant,
            damagedByVariant: damagedQtyByVariant,
          }),
        )
        .catch(() => undefined);
    }

    await addOrderNote(
      row.orderId,
      actor.id,
      `রিটার্নের পণ্য বুঝে নেওয়া হয়েছে: ভালো ${restockedUnits}টি স্টকে ফিরেছে, নষ্ট ${damagedUnits}টি। / Return received: ${restockedUnits} unit(s) restocked, ${damagedUnits} damaged.`,
    );
    await auditReturn(
      actor,
      returnId,
      row.orderId,
      { status: "APPROVED" },
      { status: "RECEIVED", restockedUnits, damagedUnits },
      input.qcNote?.trim() ? input.qcNote.trim() : undefined,
    );
    return toView((await loadReturnRow(returnId))!);
  });
}

export interface CompleteReturnValue {
  view: ReturnView;
  refundId: string | null;
  /** Σ restockable received lines — the PENDING refund's amount. */
  refundAmountPoisha: number;
  orderTransitionedToReturned: boolean;
}

/**
 * Complete: create the ONE PENDING workbench refund for the received
 * RESTOCKABLE lines and mark the return COMPLETED. Idempotent — a
 * second call on a COMPLETED return returns the recorded state and
 * creates nothing. After the flip, a now-fully-returned order walks
 * to RETURNED through the funnel (reversals fire exactly once).
 */
export async function completeReturn(
  returnId: string,
  actor: ReturnActor,
): Promise<ReturnResult<CompleteReturnValue>> {
  return asResult(async () => {
    const row = await loadForTransition(returnId);
    if (row.status === "COMPLETED") {
      const refundAmount = row.items
        .filter((i) => i.condition === "RESTOCKABLE")
        .reduce((s, i) => s + lineTotalPoisha(i.orderItem.unitPricePoisha, i.quantity), 0);
      return {
        view: toView(row),
        refundId: row.refundId,
        refundAmountPoisha: refundAmount,
        orderTransitionedToReturned: false,
      };
    }
    expectStatus(row, ["RECEIVED"], "COMPLETED");
    const refundableItems = row.items.filter((i) => i.condition === "RESTOCKABLE");
    const refundAmount = refundableItems.reduce(
      (s, i) => s + lineTotalPoisha(i.orderItem.unitPricePoisha, i.quantity),
      0,
    );
    if (refundableItems.length === 0 || refundAmount <= 0) {
      throw new ReturnServiceError(
        "NO_REFUNDABLE_LINES",
        "Nothing refundable was received (all lines damaged) — close this return instead of completing it. / ফেরতযোগ্য কোনো ভালো পণ্য পাওয়া যায়নি — রিটার্নটি সম্পন্ন না করে বন্ধ করুন।",
      );
    }

    // Guarded flip BEFORE creating the refund: a racing completion
    // sees COMPLETED and exits through the idempotent branch above,
    // so the workbench create below can only ever run once.
    const flipped = await prisma.return.updateMany({
      where: { id: returnId, status: "RECEIVED" },
      data: { status: "COMPLETED" },
    });
    if (flipped.count !== 1) {
      const fresh = (await loadReturnRow(returnId))!;
      return {
        view: toView(fresh),
        refundId: fresh.refundId,
        refundAmountPoisha: refundAmount,
        orderTransitionedToReturned: false,
      };
    }

    const actorId = actor.id ?? (await resolveUserId(actor.label));
    if (!actorId) {
      // The workbench records a creator; without a resolvable staff
      // actor there is no honest row to write. Revert the flip.
      await prisma.return.update({ where: { id: returnId }, data: { status: "RECEIVED" } });
      throw new ReturnServiceError(
        "REFUND_NOT_POSSIBLE",
        "The completing staff account could not be resolved, so no refund was recorded. / কর্মীর অ্যাকাউন্ট শনাক্ত করা যায়নি — রিফান্ড রেকর্ড হয়নি।",
      );
    }
    const refund = await createRefund(
      row.orderId,
      {
        amountPoisha: refundAmount,
        method: ORDER_METHOD_TO_REFUND_METHOD[row.order.paymentMethod] ?? "other",
        reason: `Return refund — RMA ${returnId} for order ${row.order.orderNo} (received restockable goods only; shipping not refunded) / রিটার্ন রিফান্ড — অর্ডার ${row.order.orderNo}`,
      },
      actorId,
    );
    if (!refund.ok) {
      // Revert the flip so staff can fix the blocker (usually: no
      // paid money recorded for the order yet) and complete again.
      await prisma.return.update({ where: { id: returnId }, data: { status: "RECEIVED" } });
      throw new ReturnServiceError(
        "REFUND_NOT_POSSIBLE",
        `The refund could not be recorded, so the return was not completed. ${refund.error} / রিফান্ড রেকর্ড করা যায়নি — রিটার্ন সম্পন্ন হয়নি।`,
      );
    }
    await prisma.return.update({
      where: { id: returnId },
      data: { refundId: refund.value.refund.id },
    });

    await addOrderNote(
      row.orderId,
      actor.id,
      `রিটার্ন সম্পন্ন: ${refundAmount} পয়সার রিফান্ড রেকর্ড হয়েছে (PENDING — কর্মী পাঠিয়ে workbench-এ SENT করবেন)। / Return completed: a refund of ${refundAmount} poisha was recorded as PENDING — staff send it and mark SENT in the refund workbench.`,
    );
    await auditReturn(
      actor,
      returnId,
      row.orderId,
      { status: "RECEIVED" },
      { status: "COMPLETED", refundId: refund.value.refund.id, refundAmountPoisha: refundAmount },
    );

    const walk = await maybeTransitionOrderToReturned(row.orderId, actor);
    return {
      view: toView((await loadReturnRow(returnId))!),
      refundId: refund.value.refund.id,
      refundAmountPoisha: refundAmount,
      orderTransitionedToReturned: walk.transitioned,
    };
  });
}

/**
 * Close a RECEIVED return with NO refund — the all-damaged outcome.
 * Refused while any restockable line exists (those complete instead,
 * so a refund can never be silently skipped). A close can still be
 * the step that leaves the order fully returned, so it runs the
 * same RETURNED walk as completion.
 */
export async function closeReturn(
  returnId: string,
  actor: ReturnActor,
  reason?: string,
): Promise<ReturnResult<CompleteReturnValue>> {
  return asResult(async () => {
    const row = await loadForTransition(returnId);
    expectStatus(row, ["RECEIVED"], "CLOSED");
    const refundable = row.items
      .filter((i) => i.condition === "RESTOCKABLE")
      .reduce((s, i) => s + lineTotalPoisha(i.orderItem.unitPricePoisha, i.quantity), 0);
    if (refundable > 0) {
      throw new ReturnServiceError(
        "INVALID_TRANSITION",
        "This return has restockable lines worth a refund — complete it instead of closing. / এই রিটার্নে রিফান্ডযোগ্য ভালো পণ্য আছে — বন্ধ না করে সম্পন্ন করুন।",
      );
    }
    const trimmed = reason?.trim() ?? "";
    await prisma.return.update({
      where: { id: returnId },
      data: { status: "CLOSED", decisionReason: trimmed || row.decisionReason },
    });
    await addOrderNote(
      row.orderId,
      actor.id,
      `রিটার্ন বন্ধ করা হয়েছে (কোনো রিফান্ড নয় — সব পণ্য নষ্ট/অগ্রহণযোগ্য)।${trimmed ? ` কারণ: ${trimmed}` : ""} / Return closed with no refund — all received items were damaged/unacceptable.${trimmed ? ` Reason: ${trimmed}` : ""}`,
    );
    await auditReturn(
      actor,
      returnId,
      row.orderId,
      { status: "RECEIVED" },
      { status: "CLOSED", refundAmountPoisha: 0 },
      trimmed || undefined,
    );
    const walk = await maybeTransitionOrderToReturned(row.orderId, actor);
    return {
      view: toView((await loadReturnRow(returnId))!),
      refundId: null,
      refundAmountPoisha: 0,
      orderTransitionedToReturned: walk.transitioned,
    };
  });
}

/** Route-friendly dispatcher over the lifecycle functions. */
export async function transitionReturn(
  returnId: string,
  to: string,
  actor: ReturnActor,
  opts?: { reason?: string; qcNote?: string; lineConditions?: ReceiveReturnInput["lineConditions"] },
): Promise<ReturnResult<ReturnView | CompleteReturnValue>> {
  switch (to) {
    case "APPROVED":
      return approveReturn(returnId, actor);
    case "REJECTED":
      return rejectReturn(returnId, actor, opts?.reason ?? "");
    case "RECEIVED":
      return receiveReturn(returnId, actor, {
        lineConditions: opts?.lineConditions ?? [],
        qcNote: opts?.qcNote,
      });
    case "COMPLETED":
      return completeReturn(returnId, actor);
    case "CLOSED":
      return closeReturn(returnId, actor, opts?.reason);
    default:
      return fail(
        "INVALID_TRANSITION",
        `Unknown return transition target: ${to}. / অজানা রিটার্ন অবস্থা: ${to}।`,
      );
  }
}
