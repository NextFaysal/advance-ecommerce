/**
 * Orders + customers repository — DB-backed persistence (Prisma).
 *
 * This module replaces the TEMPORARY in-memory order store (the public
 * create route's module-level array) and the src/orders/mock.ts reads in
 * the admin order/customer routes and the public track route. The mock
 * module itself stays: client components still run against browser-side
 * mock copies, which is a separate UI-wiring slice.
 *
 * CONTRACTS PRESERVED:
 * - Same TS domain shapes (src/orders/types.ts Order / Customer) in and
 *   out — routes keep their response shapes, only the storage changed.
 * - The state machine (src/orders/state-machine.ts) stays the single
 *   authority for transitions: applyOrderTransition() loads the order,
 *   runs transitionOrder(), and only then persists status + history.
 *   Nothing here writes Order.status directly.
 * - Money is integer poisha everywhere; the pricing pipeline lives in
 *   the create route (src/checkout/pricing.ts) and its breakdown is
 *   stored verbatim on the Order row.
 *
 * SCHEMA DRIFT (reported, worked around — schema.prisma NOT changed):
 * - EnrichedOrder's fraud/coupon outcome fields (fraudAction,
 *   couponStatus, rejected-coupon reason) have NO columns on Order.
 *   At create time the route builds the exact EnrichedOrder from the
 *   live assessment and returns it; this module persists what the
 *   schema supports (riskScore, discountPoisha, a CouponUsage row
 *   when the coupon exists in the DB) and can RECONSTRUCT the
 *   enrichment for a stored order: riskBand from riskLevel(riskScore),
 *   fraudAction from the scorer's documented bands (>=70
 *   require_advance, 40-69 manual_review, <40 auto_confirm — "block"
 *   never reaches storage, it is a 422), coupon outcome from the
 *   CouponUsage row. A coupon that was REJECTED at create leaves no
 *   DB trace, so a reconstructed replay reports couponStatus "none"
 *   — the create route keeps an in-process enrichment cache so
 *   same-process replays return the exact original outcome.
 * - WAVE 21 (doc 17 batch O3) closed the advance/OTP part of this
 *   drift: advanceRequired / requiresOtp are now REAL columns
 *   (migration 20261025190000_order_advance_otp) written at create
 *   from the caller's computed requirement, and orderRowToEnriched
 *   reads them back from the row — no more band reconstruction for
 *   those two fields.
 * - OrderStatusHistory.changedBy / OrderNote.author are free-text
 *   strings in the TS types but FK columns (changedById / authorId) in
 *   the schema. A changedBy that is a real User id persists exactly;
 *   anything else ("customer", "system", staff display names) is stored
 *   as NULL and reads back as "system".
 * - TS PaymentMethod is narrower than the DB enum: checkout values map
 *   1:1 (cod->COD, ...). "card" (POS-only) has NO DB value and is never
 *   written through this module. DB-only values (ROCKET, UPAY, STRIPE,
 *   PAYPAL, MANUAL_MOBILE_BANKING) read back lowercased via a cast —
 *   the runtime string is truthful, the TS union is narrower than the
 *   schema (see SCHEMA-ADDITIONS drift notes).
 *
 * Coupon usage bookkeeping: the checkout coupon itself is still
 * evaluated by the marketing module (demo records / in-memory store —
 * that module's DB swap is a separate slice) and recordCouponUse()
 * remains the caller's bookkeeping. When the applied coupon ALSO
 * exists as a DB Coupon row, createOrderRecord writes a CouponUsage row
 * in the same transaction; the schema's @@unique([couponId, orderId])
 * is the backstop that makes a second usage row for one order
 * impossible.
 */
import { prisma } from "@advance-ecommerce/db";
import {
  BundleStockError,
  deductBundleComponents,
  productTypesEnabledInDb,
  restoreBundleComponentsForOrder,
  runDigitalFulfilmentForOrder,
  validateProductTypeRules,
  type ProductTypesTx,
} from "../catalog/product-types";
import { computeBundleAvailability } from "../catalog/types";
import { getSetting } from "../lib/settings";
import { advanceConfirmBlock, type AdvanceBlockCode } from "./advance";
import { orderSearchOr, type OrderListSort } from "./list-v2";
import { riskLevel } from "./customer";
import { runDeliveredOrderHooks } from "./delivered-hooks";
import { runReversalHooks } from "./reversal-hooks";
import { publishPaymentSucceeded } from "./event-bus";
import { emitAutomationEvent } from "../automation/producers";
import { redeemGiftCardInTx } from "../marketing/gift-cards";
import { postOrderPaidErp } from "../erp/auto-posting";
import { transitionOrder, type TransitionResult } from "./state-machine";
import type {
  Customer,
  Order,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from "./types";
import type { BdAddress } from "../checkout/validation";
import type { EnrichedOrder } from "../checkout/order-enrichment";

/* ------------------------------------------------------------------ */
/* Enum mapping (TS domain <-> Prisma schema)                          */
/* ------------------------------------------------------------------ */

const PAYMENT_METHOD_TO_DB: Record<string, string> = {
  cod: "COD",
  bkash: "BKASH",
  nagad: "NAGAD",
  sslcommerz: "SSLCOMMERZ",
  aamarpay: "AAMARPAY",
  shurjopay: "SHURJOPAY",
};

const PAYMENT_METHOD_FROM_DB: Record<string, PaymentMethod> = {
  COD: "cod",
  BKASH: "bkash",
  NAGAD: "nagad",
  SSLCOMMERZ: "sslcommerz",
  AAMARPAY: "aamarpay",
  SHURJOPAY: "shurjopay",
};

function paymentMethodToDb(method: PaymentMethod): string {
  const mapped = PAYMENT_METHOD_TO_DB[method];
  if (!mapped) {
    // "card" (POS-only) and any future TS-only value: no schema enum
    // value exists, so persisting would require inventing one. Fail
    // loudly instead of writing a false method to the DB.
    throw new Error(`Payment method "${method}" has no DB enum value.`);
  }
  return mapped;
}

function paymentMethodFromDb(method: string): PaymentMethod {
  // DB-only values fall back to the lowercased runtime string (cast:
  // the TS union is narrower than the schema enum — see header drift).
  return PAYMENT_METHOD_FROM_DB[method] ?? (method.toLowerCase() as PaymentMethod);
}

/* ------------------------------------------------------------------ */
/* Row loading + mapping                                               */
/* ------------------------------------------------------------------ */

const ORDER_INCLUDE = {
  items: true,
  history: { orderBy: { createdAt: "asc" as const } },
  notes: { orderBy: { createdAt: "asc" as const } },
  tags: true,
  couponUsages: { include: { coupon: { select: { code: true } } } },
};

async function findOrderRowByIdOrNo(idOrNo: string) {
  return prisma.order.findFirst({
    where: { deletedAt: null, OR: [{ id: idOrNo }, { orderNo: idOrNo }] },
    include: ORDER_INCLUDE,
  });
}

type OrderRow = NonNullable<Awaited<ReturnType<typeof findOrderRowByIdOrNo>>>;

function orderRowToOrder(row: OrderRow): Order {
  const address: BdAddress = {
    division: row.division,
    district: row.district,
    upazila: row.upazila,
    ...(row.union ? { union: row.union } : {}),
    addressLine: row.addressLine,
  };
  return {
    id: row.id,
    orderNo: row.orderNo,
    customerId: row.customerId,
    ...(row.source ? { source: row.source } : {}),
    ...(row.resellerId ? { resellerId: row.resellerId } : {}),
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    address,
    items: row.items.map((i) => ({
      variantId: i.variantId,
      productName: i.productName,
      sku: i.sku,
      unitPricePoisha: i.unitPricePoisha,
      quantity: i.quantity,
    })),
    totalPoisha: row.totalPoisha,
    // Doc 18 (F1): the persisted money split rides the detail view so
    // the invoice print centre can render real shipping/discount lines
    // (it previously had to net them into one adjustment figure).
    shippingPoisha: row.shippingPoisha,
    discountPoisha: row.discountPoisha,
    paymentMethod: paymentMethodFromDb(row.paymentMethod),
    paymentStatus: row.paymentStatus as PaymentStatus,
    status: row.status as OrderStatus,
    ...(row.courier ? { courier: row.courier } : {}),
    ...(row.trackingId ? { trackingId: row.trackingId } : {}),
    riskScore: row.riskScore,
    advanceRequiredPoisha: row.advanceRequiredPoisha,
    advanceReason: row.advanceReason,
    advanceSatisfiedAt: row.advanceSatisfiedAt ? row.advanceSatisfiedAt.toISOString() : null,
    // Wave 27 (doc 17 O9-2): persisted slot id + gift message. The
    // gift key is present whenever the column is non-NULL so "" (gift
    // requested, no message) stays distinguishable from no-gift.
    ...(row.deliverySlot ? { deliverySlot: row.deliverySlot } : {}),
    ...(row.giftMessage !== null && row.giftMessage !== undefined
      ? { giftMessage: row.giftMessage }
      : {}),
    requiresOtp: row.requiresOtp,
    otpVerifiedAt: row.otpVerifiedAt ? row.otpVerifiedAt.toISOString() : null,
    tags: row.tags.map((t) => t.tag),
    ...(row.assigneeId ? { assignee: row.assigneeId } : {}),
    history: row.history.map((h) => ({
      from: (h.from as OrderStatus | null) ?? null,
      to: h.to as OrderStatus,
      // Only real User ids persist (FK column); anything else reads
      // back as "system" — see header drift note.
      changedBy: h.changedById ?? "system",
      ...(h.reason ? { reason: h.reason } : {}),
      changedAt: h.createdAt.toISOString(),
    })),
    notes: row.notes.map((n) => ({
      id: n.id,
      author: n.authorId ?? "system",
      text: n.text,
      createdAt: n.createdAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Rebuilds the EnrichedOrder view of a stored order (see header for
 *  exactly what is persisted vs reconstructed). */
export function orderRowToEnriched(row: OrderRow): EnrichedOrder {
  const base = orderRowToOrder(row);
  const usage = row.couponUsages[0] ?? null;
  const score = row.riskScore;
  const fraudAction: EnrichedOrder["fraudAction"] =
    score >= 70 ? "require_advance" : score >= 40 ? "manual_review" : "auto_confirm";
  return {
    ...base,
    riskBand: riskLevel(score),
    fraudAction,
    // Wave 21: persisted truth (migration order_advance_otp) — an order
    // requires an advance iff a positive requirement was recorded at
    // create, whatever its source rule was.
    advanceRequired: row.advanceRequiredPoisha > 0,
    requiresOtp: row.requiresOtp,
    couponCode: usage ? usage.coupon.code : null,
    couponStatus: usage ? "applied" : "none",
    couponDiscountPoisha: usage ? row.discountPoisha : 0,
    couponReasonBn: null,
    couponReasonEn: null,
  };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function getOrderByIdOrNo(idOrNo: string): Promise<Order | null> {
  const row = await findOrderRowByIdOrNo(idOrNo);
  return row ? orderRowToOrder(row) : null;
}

export async function findOrderByIdempotencyKey(key: string): Promise<OrderRow | null> {
  return prisma.order.findUnique({
    where: { idempotencyKey: key },
    include: ORDER_INCLUDE,
  });
}

export async function getOrderByOrderNo(orderNo: string): Promise<Order | null> {
  const row = await prisma.order.findUnique({
    where: { orderNo },
    include: ORDER_INCLUDE,
  });
  return row && row.deletedAt === null ? orderRowToOrder(row) : null;
}

/** All orders for one normalized phone, oldest first — the fraud
 *  scorer's prior-order history and the coupon first-order check. */
export async function listOrdersByPhone(phone: string): Promise<Order[]> {
  const rows = await prisma.order.findMany({
    where: { customerPhone: phone, deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: ORDER_INCLUDE,
  });
  return rows.map(orderRowToOrder);
}

export interface OrderListFilters {
  status?: string;
  paymentStatus?: string;
  /** TS-domain payment method (lowercase); unmapped values match nothing. */
  paymentMethod?: string;
  courier?: string;
  search?: string;
  /** List v2 (doc 17 O6-2): sort key from src/orders/list-v2. Absent =
   *  the historical createdAt-desc order every existing consumer sees. */
  sort?: OrderListSort;
  page: number;
  pageSize: number;
}

const ORDER_LIST_ORDER_BY: Record<OrderListSort, Record<string, string>[]> = {
  createdAt_desc: [{ createdAt: "desc" }],
  createdAt_asc: [{ createdAt: "asc" }],
  totalPoisha_desc: [{ totalPoisha: "desc" }, { createdAt: "desc" }],
  totalPoisha_asc: [{ totalPoisha: "asc" }, { createdAt: "desc" }],
  // Enum order in the schema follows the fulfilment lifecycle, so a
  // status sort groups orders the way the kanban reads.
  status_asc: [{ status: "asc" }, { createdAt: "desc" }],
  status_desc: [{ status: "desc" }, { createdAt: "desc" }],
};

export async function listOrders(
  filters: OrderListFilters,
): Promise<{ rows: Order[]; total: number }> {
  const where: Record<string, unknown> = { deletedAt: null };
  if (filters.status) where.status = filters.status;
  if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
  if (filters.paymentMethod) {
    const dbMethod = PAYMENT_METHOD_TO_DB[filters.paymentMethod];
    if (!dbMethod) return { rows: [], total: 0 };
    where.paymentMethod = dbMethod;
  }
  if (filters.courier) where.courier = filters.courier;
  if (filters.search) {
    // List v2 (O6-2): the shared search OR (adds district +
    // phone-suffix matching) lives in src/orders/list-v2 so the rows
    // and the status counts can never disagree about a search.
    where.OR = orderSearchOr(filters.search);
  }
  const [total, rows] = await Promise.all([
    prisma.order.count({ where: where as never }),
    prisma.order.findMany({
      where: where as never,
      orderBy: (filters.sort ? ORDER_LIST_ORDER_BY[filters.sort] : [{ createdAt: "desc" }]) as never,
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      include: ORDER_INCLUDE,
    }),
  ]);
  return { rows: rows.map(orderRowToOrder), total };
}

/* ------------------------------------------------------------------ */
/* Variant price source (public checkout)                              */
/* ------------------------------------------------------------------ */

export interface ServerVariantSnapshot {
  variantId: string;
  productName: string;
  sku: string;
  unitPricePoisha: number;
  stock: number;
  /** Wave 15: the owning product's type + component-derived bundle
   *  availability (null for non-bundles / component-less bundles).
   *  Checkout pre-checks use the bundle number when the product-types
   *  flag is ON — a bundle variant's own stock cache is not the
   *  sellable count. */
  productType: string;
  bundleAvailability: number | null;
  /** Wave 20: the owning product's per-unit weight (Product.weightGrams,
   *  0 when unset) — the create route sums weight x qty into the
   *  shipping engine's totalWeightGrams. */
  weightGrams: number;
  /** Wave 20: the owning product's category slug — the create route's
   *  COD rules (orders.rules.cod_disabled_categories) match on it. */
  categorySlug: string;
  /** Wave 21: the owning product's preorder deposit percent
   *  (Product.preorderDepositPercent, wave-15 terms of record), or
   *  null when the product carries no preorder deposit term. The
   *  create routes price the preorder-deposit advance candidate from
   *  it for PREORDER lines. */
  preorderDepositPercent: number | null;
}

/**
 * Server-side price/SKU/name/stock source for checkout — a Prisma
 * ProductVariant query (the route's documented replacement for the
 * TEMPORARY catalog mock map). Prices are purchase-time snapshotted
 * onto OrderItems by the caller; stock is the variant's denormalized
 * cache (the stock_movements ledger stays the inventory module's
 * source of truth, unchanged by this swap).
 */
export async function getVariantSnapshots(
  variantIds: string[],
): Promise<Map<string, ServerVariantSnapshot>> {
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, deletedAt: null },
    include: {
      product: {
        select: {
          titleEn: true,
          type: true,
          weightGrams: true,
          preorderDepositPercent: true,
          category: { select: { slug: true } },
          bundleComponents: {
            select: { quantity: true, componentVariant: { select: { stock: true } } },
          },
        },
      },
    },
  });
  const map = new Map<string, ServerVariantSnapshot>();
  for (const v of variants) {
    const components = v.product.bundleComponents ?? [];
    map.set(v.id, {
      variantId: v.id,
      productName: v.product.titleEn,
      sku: v.sku,
      unitPricePoisha: v.pricePoisha,
      stock: v.stock,
      productType: v.product.type,
      weightGrams: v.product.weightGrams ?? 0,
      categorySlug: v.product.category.slug,
      preorderDepositPercent: v.product.preorderDepositPercent ?? null,
      bundleAvailability:
        v.product.type === "BUNDLE" && components.length > 0
          ? computeBundleAvailability(
              components.map((c) => ({ quantity: c.quantity, componentStock: c.componentVariant.stock })),
            )
          : null,
    });
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Stock reservation for order lines (wave 19, plan 17 batch O1)       */
/* ------------------------------------------------------------------ */

/**
 * Reserve EVERY ordinary order line through the stock ledger, inside
 * the create transaction — the generalisation of the wave-15 bundle
 * component seam (src/catalog/product-types.ts) to all items:
 *
 *  - Quantities are aggregated per variant (duplicate lines claim
 *    once) and claimed in sorted variant-id order, so concurrent
 *    creates take variant row locks in the same sequence.
 *  - The claim is a GUARDED decrement (UPDATE ... WHERE stock >= qty):
 *    the row lock + predicate re-check make oversell impossible under
 *    concurrency. A failed claim throws BundleStockError — the typed
 *    INSUFFICIENT_STOCK error both create routes already map to a 400 —
 *    and the whole create transaction rolls back: no order, no partial
 *    reserves, nothing.
 *  - Each claimed line writes the same ledger shape as the bundle
 *    seam: a SALE_RESERVE StockMovement (referenceType "ORDER",
 *    referenceId = order id) against the default warehouse, and an
 *    InventoryItem upsert whose quantityOnHand mirrors the variant
 *    cache with quantityReserved incremented. If no warehouse exists,
 *    the cache still moves and the movement is skipped with a warning
 *    (the bundle seam's ledgerPending precedent).
 *  - BUNDLE line variants are SKIPPED while the product-types flag is
 *    ON (validateProductTypeRules reports them): the bundle variant is
 *    a pricing shell — deductBundleComponents reserves its components
 *    instead, and claiming the shell too would double-claim. While the
 *    flag is OFF the set is empty and a bundle variant's own cache is
 *    claimed like any other line, matching the routes' pre-check.
 *  - SIMPLE, PREORDER and DIGITAL lines all reserve. PREORDER: the
 *    routes already gate preorder lines on the variant cache (the cap
 *    in validateProductTypeRules is an ADDITIONAL gate), so claiming
 *    keeps create semantics identical — a preorder unit now also holds
 *    its stock. DIGITAL: delivery is by grant, but the routes check
 *    the same cache, so claiming keeps one uniform stock truth.
 *
 * There is NO commit step at DELIVERED: this codebase never
 * implemented reserve->commit for any item (the wave-15 header
 * documents SALE_RESERVE as the terminal ledger state for bundle
 * components), so ordinary reservations are likewise terminal at
 * delivery. RETURNED orders are NOT auto-restocked here — restocking
 * is the RMA/QC decision (plan 17, batch O7).
 */
async function reserveOrderLineItems(
  tx: ProductTypesTx,
  items: Order["items"],
  bundleVariantIds: ReadonlySet<string>,
  orderId: string,
  orderNo: string,
): Promise<void> {
  const wanted = new Map<string, number>();
  for (const item of items) {
    if (bundleVariantIds.has(item.variantId)) continue;
    wanted.set(item.variantId, (wanted.get(item.variantId) ?? 0) + item.quantity);
  }
  if (wanted.size === 0) return;
  const warehouse = await tx.warehouse.findFirst({
    where: { deletedAt: null, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  for (const variantId of [...wanted.keys()].sort()) {
    const qty = wanted.get(variantId) ?? 0;
    const variant = await tx.productVariant.findUnique({
      where: { id: variantId },
      select: { stock: true, sku: true },
    });
    if (!variant) {
      throw new BundleStockError(`Variant ${variantId} vanished during order create.`, {
        variantId,
        sku: "",
        available: 0,
        required: qty,
      });
    }
    // The atomic claim: guarded decrement. count 0 means another
    // transaction took the stock first (or it never sufficed) — fail
    // the whole order rather than oversell.
    const claimed = await tx.productVariant.updateMany({
      where: { id: variantId, deletedAt: null, stock: { gte: qty } },
      data: { stock: { decrement: qty } },
    });
    if (claimed.count !== 1) {
      throw new BundleStockError(`Insufficient stock for ${variant.sku}.`, {
        variantId,
        sku: variant.sku,
        available: variant.stock,
        required: qty,
      });
    }
    if (!warehouse) {
      console.warn(
        `[orders] stock reserve for order ${orderNo}: no warehouse to book the ledger movement against (variant ${variantId}, qty ${qty}) — stock cache moved, movement skipped.`,
      );
      continue;
    }
    // Re-read after the claim so the movement's before/after are the
    // committed figures even when a concurrent claim landed first.
    const afterRow = await tx.productVariant.findUnique({
      where: { id: variantId },
      select: { stock: true },
    });
    const after = afterRow?.stock ?? variant.stock - qty;
    const before = after + qty;
    await tx.stockMovement.create({
      data: {
        variantId,
        warehouseId: warehouse.id,
        type: "SALE_RESERVE",
        quantityDelta: -qty,
        quantityBefore: before,
        quantityAfter: after,
        referenceType: "ORDER",
        referenceId: orderId,
        reason: `Stock reserve for order ${orderNo}`,
        actorId: null,
      },
    });
    await tx.inventoryItem.upsert({
      where: { variantId_warehouseId: { variantId, warehouseId: warehouse.id } },
      create: {
        variantId,
        warehouseId: warehouse.id,
        quantityOnHand: after,
        quantityReserved: qty,
      },
      update: {
        quantityOnHand: after,
        quantityReserved: { increment: qty },
      },
    });
  }
}

/**
 * Release every unreleased SALE_RESERVE an order holds (ordinary
 * lines AND bundle components), restoring the variant caches. Runs on
 * CANCELLED from both status funnels, right after the wave-15 bundle
 * release; unlike that function this one is NOT gated by the
 * product-types flag, so a reserve written while the flag was ON is
 * still released if the flag has since been turned OFF.
 *
 * Ledger-idempotent, grouped per (variant, warehouse): released
 * quantity is recomputed from the persisted SALE_RELEASE movements on
 * every call, so a second run (or a run after the bundle release
 * already freed everything) is a strict no-op. Never throws — callers
 * run it after the status commit (delivered-hooks discipline).
 */
export async function releaseOrderStockReservations(orderId: string): Promise<void> {
  try {
    const reserves = await prisma.stockMovement.findMany({
      where: { referenceType: "ORDER", referenceId: orderId, type: "SALE_RESERVE" },
      select: { variantId: true, warehouseId: true, quantityDelta: true },
    });
    if (reserves.length === 0) return;
    const releases = await prisma.stockMovement.findMany({
      where: { referenceType: "ORDER", referenceId: orderId, type: "SALE_RELEASE" },
      select: { variantId: true, warehouseId: true, quantityDelta: true },
    });
    const keyOf = (variantId: string, warehouseId: string) => `${variantId}|${warehouseId}`;
    const reservedByKey = new Map<string, { variantId: string; warehouseId: string; qty: number }>();
    for (const r of reserves) {
      const key = keyOf(r.variantId, r.warehouseId);
      const entry = reservedByKey.get(key) ?? { variantId: r.variantId, warehouseId: r.warehouseId, qty: 0 };
      entry.qty += -r.quantityDelta;
      reservedByKey.set(key, entry);
    }
    const releasedByKey = new Map<string, number>();
    for (const r of releases) {
      const key = keyOf(r.variantId, r.warehouseId);
      releasedByKey.set(key, (releasedByKey.get(key) ?? 0) + r.quantityDelta);
    }
    for (const { variantId, warehouseId, qty } of reservedByKey.values()) {
      const outstanding = qty - (releasedByKey.get(keyOf(variantId, warehouseId)) ?? 0);
      if (outstanding <= 0) continue;
      await prisma.$transaction(async (tx) => {
        // Recompute inside the transaction: a concurrent release run
        // for the same order may have freed some (or all) of this
        // group since the outer scan — release only what is still
        // outstanding so two runs can never double-restore.
        const releasedNow = await tx.stockMovement.aggregate({
          where: {
            referenceType: "ORDER",
            referenceId: orderId,
            type: "SALE_RELEASE",
            variantId,
            warehouseId,
          },
          _sum: { quantityDelta: true },
        });
        const toRelease = qty - (releasedNow._sum.quantityDelta ?? 0);
        if (toRelease <= 0) return;
        // Guarded increment back, then re-read so the movement's
        // before/after are the committed figures.
        const restored = await tx.productVariant.updateMany({
          where: { id: variantId },
          data: { stock: { increment: toRelease } },
        });
        if (restored.count !== 1) return;
        const row = await tx.productVariant.findUnique({
          where: { id: variantId },
          select: { stock: true },
        });
        if (!row) return;
        const after = row.stock;
        const before = after - toRelease;
        await tx.stockMovement.create({
          data: {
            variantId,
            warehouseId,
            type: "SALE_RELEASE",
            quantityDelta: toRelease,
            quantityBefore: before,
            quantityAfter: after,
            referenceType: "ORDER",
            referenceId: orderId,
            reason: "Order stock reservation released (order cancelled)",
            actorId: null,
          },
        });
        await tx.inventoryItem.upsert({
          where: { variantId_warehouseId: { variantId, warehouseId } },
          create: {
            variantId,
            warehouseId,
            quantityOnHand: after,
            quantityReserved: 0,
          },
          update: {
            quantityOnHand: after,
            quantityReserved: { decrement: toRelease },
          },
        });
      });
    }
    // W0 follow-up (doc 21 G3-9): a release that restores stock can
    // revive a sold-out variant — offer the released variants to the
    // back-in-stock producer, which re-checks stock + pending signups
    // and dedupes by job id, so nobody is notified twice.
    const releasedVariantIds = [
      ...new Set([...reservedByKey.values()].map((r) => r.variantId)),
    ];
    if (releasedVariantIds.length > 0) {
      void import("../storefront-ux/back-in-stock-notify")
        .then((m) => {
          for (const variantId of releasedVariantIds) {
            void m.notifyBackInStockForVariant(variantId);
          }
        })
        .catch(() => {});
    }
  } catch (err) {
    console.error(`[orders] stock reservation release failed for order ${orderId}:`, err);
  }
}

/* ------------------------------------------------------------------ */
/* Create (public checkout)                                            */
/* ------------------------------------------------------------------ */

export interface CreateOrderRecordInput {
  idempotencyKey: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  address: BdAddress;
  items: Order["items"];
  pricing: {
    subtotalPoisha: number;
    discountPoisha: number;
    shippingPoisha: number;
    codFeePoisha: number;
    taxPoisha: number;
    totalPoisha: number;
  };
  paymentMethod: PaymentMethod;
  riskScore: number;
  /** Applied coupon (code + pipeline discount), or null. A CouponUsage
   *  row is written only when this code exists as a DB Coupon row. */
  appliedCoupon: { code: string; discountPoisha: number } | null;
  note?: string;
  /** Create channel stored on Order.source. Defaults to "website"
   *  (public checkout); the admin manual-create route passes "manual". */
  source?: string;
  /** Reseller attribution stored on Order.resellerId (wave 6): the
   *  public checkout route and the admin manual-create route resolve
   *  the submitted ?ref= code via resolveResellerAttribution (ACTIVE
   *  resellers only) and pass the id here, so attribution is recorded
   *  at create instead of patched later. */
  resellerId?: string;
  /** Advance requirement (wave 21, doc 17 batch O3): the winning
   *  amount from the caller's MAX computation over the rules
   *  threshold, the fraud band, prepaid-full-total, preorder deposits
   *  and staff-set amounts (src/orders/advance.pickAdvanceRequirement).
   *  Persisted on the Order row; a positive value also writes an order
   *  note in the create transaction so the requirement is visible on
   *  the order timeline from birth. 0/omitted = no advance. */
  advanceRequiredPoisha?: number;
  /** Bilingual winning-rule label (src/orders/advance
   *  ADVANCE_REASON_LABELS); stored verbatim on Order.advanceReason. */
  advanceReason?: string;
  /** Persisted on Order.requiresOtp (the fraud band's OTP flag). The
   *  OTP challenge itself is issued/verified by the O3-2 service. */
  requiresOtp?: boolean;
  /** Delivery slot ID (wave 27, doc 17 batch O9-2): callers resolve
   *  the customer's/staff's submitted id against the configured set
   *  (src/checkout/delivery-slots) and pass the canonical id here;
   *  persisted verbatim on Order.deliverySlot. */
  deliverySlot?: string;
  /** Gift message (wave 27): persisted verbatim on Order.giftMessage
   *  ("" = gift requested with no message); omit for no gift. */
  giftMessage?: string;
  /** Gift-card redemption (ADV-18): the checkout route resolved +
   *  read-only validated the code; the redemption itself is written
   *  HERE, inside the create transaction, by
   *  src/marketing/gift-cards.redeemGiftCardInTx (card row locked,
   *  balance re-derived from the ledger under the lock). A failure
   *  throws GiftCardRedemptionError and rolls the whole create back —
   *  an order is never born claiming gift-card coverage it did not
   *  record. pricing.totalPoisha is already net of the redemption. */
  giftCardRedemption?: { cardId: string; amountPoisha: number; codeLast4: string } | null;
}

export type CreateOrderRecordResult =
  | {
      replayed: false;
      orderId: string;
      orderNo: string;
      createdAt: string;
      /** DB id of the checkout note row, when a note was supplied. */
      noteId: string | null;
      /** Gift-card balance (poisha) after this order's redemption,
       *  derived from the ledger inside the create transaction;
       *  null when the order redeemed no gift card. */
      giftCardBalanceAfterPoisha: number | null;
    }
  | { replayed: true; existing: OrderRow };

/* ------------------------------------------------------------------ */
/* VAT split recording (wave 7)                                        */
/* ------------------------------------------------------------------ */

/**
 * Split a VAT-INCLUSIVE total into its VAT portion at a rate in basis
 * points: vat = round(total * rate / (10000 + rate)); the remainder is
 * the net. Pure — the ERP sales-VAT report's rows are derived from
 * exactly these recorded figures (net = totalPoisha − vatPoisha).
 */
export function computeVatInclusiveSplit(
  totalPoisha: number,
  vatRateBps: number,
): { vatPoisha: number; netPoisha: number } {
  const vatPoisha = Math.round((totalPoisha * vatRateBps) / (10000 + vatRateBps));
  return { vatPoisha, netPoisha: totalPoisha - vatPoisha };
}

/**
 * The configured VAT rate (Settings key `accounting.vat_rate_bps`,
 * basis points), or null when not configured. There is NO default
 * rate: an unset/blank/invalid value means order creation records no
 * VAT split. A settings-read failure also resolves to null — VAT
 * bookkeeping must never break checkout.
 */
async function readConfiguredVatRateBps(): Promise<number | null> {
  try {
    const raw = await getSetting("accounting.vat_rate_bps");
    if (raw === null || raw.trim() === "") return null;
    const rate = Number.parseInt(raw, 10);
    if (!Number.isInteger(rate) || rate <= 0 || rate > 10000) return null;
    return rate;
  } catch {
    return null;
  }
}

function isUniqueViolation(e: unknown, field?: string): boolean {
  if (typeof e !== "object" || e === null || !("code" in e)) return false;
  const err = e as { code?: string; meta?: { target?: unknown } };
  if (err.code !== "P2002") return false;
  if (!field) return true;
  const target = err.meta?.target;
  return Array.isArray(target) ? target.includes(field) : String(target ?? "").includes(field);
}

/** Asia/Dhaka calendar day as YYYYMMDD — order numbers are sequenced
 *  per LOCAL day (the shop's day), not per UTC day. */
function dhakaDayStamp(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}${part("month")}${part("day")}`;
}

/**
 * Human order numbers (wave 20, plan 17 batch O2): ORD-YYYYMMDD-NNNN,
 * sequenced per Asia/Dhaka day from the OrderSequence counter INSIDE
 * the create transaction. The INSERT ... ON CONFLICT DO UPDATE ...
 * RETURNING increment is atomic, so concurrent creates can never draw
 * the same sequence (and a rolled-back create simply skips a number —
 * gaps are acceptable, duplicates are not). NNNN is zero-padded to 4
 * and grows past 9999 naturally. This replaces the old ORD-<epoch-ms>
 * scheme (timestamp-based: guessable, leaked volume); existing orders
 * keep their historical numbers — nothing renumbers history. The
 * orderNo @unique constraint remains as the backstop.
 */
async function nextOrderNoTx(tx: ProductTypesTx): Promise<string> {
  const day = dhakaDayStamp();
  const rows = await tx.$queryRaw<{ lastSeq: number }[]>`
    INSERT INTO "OrderSequence" ("day", "lastSeq")
    VALUES (${day}, 1)
    ON CONFLICT ("day") DO UPDATE
    SET "lastSeq" = "OrderSequence"."lastSeq" + 1
    RETURNING "lastSeq"`;
  const seq = rows[0]?.lastSeq ?? 1;
  return `ORD-${day}-${String(seq).padStart(4, "0")}`;
}

/**
 * The documented create transaction (formerly createOrderTransactionSteps
 * in the public route — now implemented):
 *   1. customer find-or-create by normalized phone (+ default Address)
 *   2. Order + OrderItems with purchase-time snapshots
 *   3. OrderStatusHistory (null -> PENDING)
 *   4. Payment row (UNPAID until a gateway verifies)
 *   5. CouponUsage row when the applied coupon exists in the DB
 *      (@@unique([couponId, orderId]) backstop)
 * Idempotency: the caller checks findOrderByIdempotencyKey first; the
 * UNIQUE idempotencyKey column is the backstop — a P2002 on it is
 * converted here into { replayed: true } with the winning row.
 * Order numbers (wave 20): ORD-YYYYMMDD-NNNN, minted inside this
 * transaction from the per-day OrderSequence counter — every caller
 * of this funnel (public checkout, admin manual create, ...) gets
 * the human format with no per-route work.
 * Stock reservation (WAVE 19, plan 17 batch O1): inside this same
 * transaction, reserveOrderLineItems claims EVERY ordinary line
 * through the stock ledger (guarded variant-cache decrement +
 * SALE_RESERVE movement + InventoryItem upsert), so a reservation can
 * never exist without its order and concurrent creates cannot
 * oversell. The claim sits after the idempotency gates (the caller's
 * replay check and the UNIQUE backstop below), so a replayed create
 * never double-reserves. CANCELLED releases via
 * releaseOrderStockReservations (both status funnels).
 * WAVE 15 (product types, module.product_types flag): inside this
 * same transaction, validateProductTypeRules enforces PREORDER
 * unit caps and BUNDLE component availability, and
 * deductBundleComponents then reserves the components through the
 * stock ledger (SALE_RESERVE) — see src/catalog/product-types.ts for
 * the exact seam behaviour. Typed failures (BundleStockError /
 * PreorderCapError) roll the whole create back.
 */
export async function createOrderRecord(
  input: CreateOrderRecordInput,
): Promise<CreateOrderRecordResult> {
  const dbCoupon = input.appliedCoupon
    ? await prisma.coupon.findUnique({
        where: { code: input.appliedCoupon.code },
        select: { id: true },
      })
    : null;
  // VAT split: recorded only when a rate is configured in Settings —
  // computed from the VAT-inclusive total and stored on the Order row
  // in the create transaction below (NULL when unconfigured).
  const vatRateBps = await readConfiguredVatRateBps();
  const vatSplit =
    vatRateBps !== null ? computeVatInclusiveSplit(input.pricing.totalPoisha, vatRateBps) : null;
  let noteId: string | null = null;
  let giftCardBalanceAfterPoisha: number | null = null;
  try {
    const created = await prisma.$transaction(async (tx) => {
      // Wave 20: the order number is minted INSIDE the transaction
      // from the per-day OrderSequence counter (see nextOrderNoTx), so
      // the sequence draw and the order commit or roll back together.
      const orderNo = await nextOrderNoTx(tx);
      // Wave 15 (product types): preorder caps + bundle component
      // availability, validated before anything is written; the
      // returned needs are deducted after the order row exists.
      // Wave 19: bundleVariantIds tells the general reservation which
      // line variants are bundle shells (skip — components carry the
      // stock) while the flag is ON; empty when the flag is OFF.
      const { componentNeeds, bundleVariantIds } = await validateProductTypeRules(tx, input.items);
      const customer = await tx.customer.upsert({
        where: { phone: input.customerPhone },
        create: {
          name: input.customerName,
          phone: input.customerPhone,
          email: input.customerEmail || null,
        },
        update: {
          name: input.customerName,
          ...(input.customerEmail ? { email: input.customerEmail } : {}),
        },
      });
      const addressCount = await tx.address.count({ where: { customerId: customer.id } });
      if (addressCount === 0) {
        await tx.address.create({
          data: {
            customerId: customer.id,
            division: input.address.division,
            district: input.address.district,
            upazila: input.address.upazila,
            union: input.address.union ?? null,
            addressLine: input.address.addressLine,
            isDefault: true,
          },
        });
      }
      const order = await tx.order.create({
        data: {
          orderNo,
          customerId: customer.id,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          division: input.address.division,
          district: input.address.district,
          upazila: input.address.upazila,
          union: input.address.union ?? null,
          addressLine: input.address.addressLine,
          status: "PENDING",
          paymentMethod: paymentMethodToDb(input.paymentMethod) as never,
          paymentStatus: "UNPAID",
          subtotalPoisha: input.pricing.subtotalPoisha,
          discountPoisha: input.pricing.discountPoisha,
          shippingPoisha: input.pricing.shippingPoisha,
          codFeePoisha: input.pricing.codFeePoisha,
          taxPoisha: input.pricing.taxPoisha,
          vatPoisha: vatSplit ? vatSplit.vatPoisha : null,
          vatRateBps: vatSplit ? vatRateBps : null,
          totalPoisha: input.pricing.totalPoisha,
          riskScore: input.riskScore,
          advanceRequiredPoisha: input.advanceRequiredPoisha ?? 0,
          advanceReason: input.advanceRequiredPoisha
            ? (input.advanceReason ?? null)
            : null,
          requiresOtp: input.requiresOtp ?? false,
          deliverySlot: input.deliverySlot ?? null,
          giftMessage: input.giftMessage ?? null,
          source: input.source ?? "website",
          resellerId: input.resellerId ?? null,
          idempotencyKey: input.idempotencyKey,
          items: {
            create: input.items.map((i) => ({
              variantId: i.variantId,
              productName: i.productName,
              sku: i.sku,
              unitPricePoisha: i.unitPricePoisha,
              quantity: i.quantity,
            })),
          },
        },
      });
      // Wave 15: reserve bundle components through the stock ledger
      // (no-op for non-bundle orders / flag OFF — the needs map is
      // empty in both cases).
      await deductBundleComponents(tx, componentNeeds, order.id, orderNo);
      // Wave 19 (plan 17, O1): reserve every ordinary line the same
      // way — guarded claim inside this transaction, so the order and
      // its reservations commit or roll back together.
      await reserveOrderLineItems(tx, input.items, bundleVariantIds, order.id, orderNo);
      await tx.orderStatusHistory.create({
        data: { orderId: order.id, from: null, to: "PENDING", changedById: null },
      });
      if (input.note) {
        const note = await tx.orderNote.create({
          data: { orderId: order.id, authorId: null, text: input.note },
        });
        noteId = note.id;
      }
      // Wave 21 (doc 17, O3): the advance requirement is part of the
      // order's timeline from birth — a note in the same transaction,
      // so staff opening the order see exactly what is due and why,
      // and the CONFIRMED gate's refusal never comes as a surprise.
      if (input.advanceRequiredPoisha && input.advanceRequiredPoisha > 0) {
        await tx.orderNote.create({
          data: {
            orderId: order.id,
            authorId: null,
            text: `অগ্রিম পেমেন্ট প্রয়োজন: ${input.advanceRequiredPoisha} পয়সা (${input.advanceReason ?? "advance"}) — অগ্রিম পরিশোধ না হলে এই অর্ডার নিশ্চিত করা যাবে না। / Advance payment required: ${input.advanceRequiredPoisha} poisha (${input.advanceReason ?? "advance"}) — this order cannot be confirmed until the advance is paid.`,
          },
        });
      }
      await tx.payment.create({
        data: {
          orderId: order.id,
          method: paymentMethodToDb(input.paymentMethod) as never,
          amountPoisha: input.pricing.totalPoisha,
          paidPoisha: 0,
          status: "UNPAID",
        },
      });
      if (dbCoupon && input.appliedCoupon) {
        await tx.couponUsage.create({
          data: {
            couponId: dbCoupon.id,
            orderId: order.id,
            customerId: customer.id,
            discountPoisha: input.appliedCoupon.discountPoisha,
          },
        });
      }
      // ADV-18 gift card: the redemption write lives in the SAME
      // transaction as the order + payment + coupon usage, after the
      // Payment row (whose amountPoisha is the post-gift-card total —
      // the amount actually due). redeemGiftCardInTx locks the card
      // row and re-derives the balance under the lock, so a balance
      // race since the route's read-only validation fails the whole
      // create instead of overdrawing the card. The covering note
      // makes the tender visible on the order timeline (the Payment
      // row alone cannot show it: there is no GIFT_CARD method and
      // the card coverage is not collected money).
      if (input.giftCardRedemption) {
        const redeemed = await redeemGiftCardInTx(tx, {
          cardId: input.giftCardRedemption.cardId,
          orderId: order.id,
          amountPoisha: input.giftCardRedemption.amountPoisha,
        });
        giftCardBalanceAfterPoisha = redeemed.balanceAfterPoisha;
        await tx.orderNote.create({
          data: {
            orderId: order.id,
            authorId: null,
            text: `গিফট কার্ড (…${input.giftCardRedemption.codeLast4}) দিয়ে ${input.giftCardRedemption.amountPoisha} পয়সা পরিশোধ হয়েছে — অবশিষ্ট ব্যালেন্স ${redeemed.balanceAfterPoisha} পয়সা। / Gift card (…${input.giftCardRedemption.codeLast4}) covered ${input.giftCardRedemption.amountPoisha} poisha — remaining balance ${redeemed.balanceAfterPoisha} poisha.`,
          },
        });
      }
      return order;
    });
    // Automation lifecycle (ADV-7): order.created fires post-commit so
    // enabled automation rules can evaluate this order. The producer
    // is flag-gated and never throws — automation can never fail an
    // order create. Replays return above and never reach here.
    await emitAutomationEvent("order.created", created.id);
    return {
      replayed: false,
      orderId: created.id,
      orderNo: created.orderNo,
      createdAt: created.createdAt.toISOString(),
      noteId,
      giftCardBalanceAfterPoisha,
    };
  } catch (e) {
    if (isUniqueViolation(e, "idempotencyKey")) {
      const existing = await findOrderByIdempotencyKey(input.idempotencyKey);
      if (existing) return { replayed: true, existing };
    }
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Transitions (state machine persists through here)                   */
/* ------------------------------------------------------------------ */

/** Resolves a changedBy label to a User id when it is one; the schema
 *  history column is an FK, so free-text actors persist as NULL. */
async function resolveUserId(label: string): Promise<string | null> {
  if (!label) return null;
  const user = await prisma.user.findUnique({ where: { id: label }, select: { id: true } });
  return user?.id ?? null;
}

export type ApplyTransitionResult =
  | { kind: "ok"; order: Order; from: OrderStatus }
  | { kind: "not_found" }
  | { kind: "invalid"; error: string }
  | { kind: "blocked"; code: AdvanceBlockCode; error: string };

export interface ApplyTransitionOptions {
  /**
   * Advance-gate override (wave 21, doc 17 batch O3): honoured ONLY
   * for an ADVANCE_NOT_PAID block and ONLY when actorPermissions
   * includes `orders.override_advance`. The override is recorded on
   * the order timeline (note with actor + reason) and the API route
   * mirrors it into the audit log. An OTP block is NEVER overridable
   * through this channel.
   */
  advanceOverride?: { reason: string };
  /** The acting user's permission keys (session), for the override. */
  actorPermissions?: readonly string[];
}

/**
 * Loads the order, decides the transition with the state machine (the
 * single authority — it also publishes order.status_changed on its
 * success branch), then persists status + the appended history row in
 * one transaction. An invalid transition writes NOTHING.
 *
 * CONFIRM GATE (wave 21, doc 17 batch O3): PENDING -> CONFIRMED is
 * additionally refused ({ kind: "blocked" }, nothing written) while
 * the order's persisted advance is unsatisfied or its OTP is
 * unverified — src/orders/advance.advanceConfirmBlock decides, this
 * funnel enforces it for every caller (admin PATCH, call-center
 * outcomes, ...). Cancellation is never gated.
 */
export async function applyOrderTransition(
  idOrNo: string,
  to: OrderStatus,
  changedBy: string,
  reason?: string,
  opts?: ApplyTransitionOptions,
): Promise<ApplyTransitionResult> {
  const row = await findOrderRowByIdOrNo(idOrNo);
  if (!row) return { kind: "not_found" };
  const order = orderRowToOrder(row);
  // The gate runs before the state machine so a blocked confirm emits
  // no status_changed event and writes nothing.
  let advanceOverridden = false;
  if (to === "CONFIRMED" && row.status === "PENDING") {
    const block = advanceConfirmBlock({
      advanceRequiredPoisha: row.advanceRequiredPoisha,
      advanceSatisfiedAt: row.advanceSatisfiedAt,
      requiresOtp: row.requiresOtp,
      otpVerifiedAt: row.otpVerifiedAt,
    });
    if (block) {
      const override = opts?.advanceOverride;
      const permitted =
        block.code === "ADVANCE_NOT_PAID" &&
        !!override?.reason?.trim() &&
        (opts?.actorPermissions ?? []).includes("orders.override_advance");
      if (!permitted) return { kind: "blocked", code: block.code, error: block.message };
      advanceOverridden = true;
    }
  }
  const result: TransitionResult = transitionOrder(order, to, changedBy, reason);
  if (!result.ok) return { kind: "invalid", error: result.error };
  const changedById = await resolveUserId(changedBy);
  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: row.id }, data: { status: to } });
    await tx.orderStatusHistory.create({
      data: {
        orderId: row.id,
        from: order.status,
        to,
        changedById,
        reason: reason ?? null,
      },
    });
  });
  // Advance override (wave 21): the override is part of the order's
  // permanent timeline — actor + reason on a note, written only after
  // the confirm committed (a failed transition records no override).
  // The API route additionally mirrors it into the audit log.
  if (advanceOverridden && opts?.advanceOverride) {
    await prisma.orderNote.create({
      data: {
        orderId: row.id,
        authorId: changedById,
        text: `অগ্রিম পেমেন্ট ছাড়াই অর্ডার নিশ্চিত করা হয়েছে (override) — কারণ: ${opts.advanceOverride.reason} / Order confirmed without the advance payment (override) — reason: ${opts.advanceOverride.reason}`,
      },
    });
  }
  // Delivered-order fan-out (loyalty EARN + referral reward, reseller
  // wallet credit, vendor commission lines) — only on the transition
  // INTO DELIVERED, after the status commit. The hook never throws, so
  // a credit failure can never fail the delivery itself; every credit
  // is idempotent per order (see src/orders/delivered-hooks.ts).
  if (to === "DELIVERED") {
    await runDeliveredOrderHooks(row.id);
  }
  // Wave 15: cancelling releases any bundle component reserves this
  // order holds (ledger-idempotent, never throws — see product-types).
  // Wave 19 (plan 17, O1): the general release then frees every
  // remaining unreleased reserve (ordinary lines; also bundle
  // components when the product-types flag is OFF at cancel time and
  // the wave-15 release skipped). Sequentially idempotent.
  if (to === "CANCELLED") {
    await restoreBundleComponentsForOrder(row.id);
    await releaseOrderStockReservations(row.id);
  }
  // Wave 18 (plan 17, O0): reversal engine — cancelling restores the
  // coupon usage; RETURNED / REFUNDED claw back the delivered-order
  // credits (loyalty, reseller wallet, vendor commission). The hook
  // never throws and every reversal is exactly-once (see
  // src/orders/reversal-hooks.ts).
  if (to === "CANCELLED" || to === "RETURNED" || to === "REFUNDED") {
    await runReversalHooks(row.id);
  }
  // Automation lifecycle (ADV-7): every committed transition emits
  // order.status_changed; DELIVERED / CANCELLED automations match on
  // this event's orderStatus condition (the engine has no separate
  // delivered/cancelled triggers). The dedupe suffix carries the
  // target status so a re-delivered event for a different transition
  // is not swallowed by BullMQ jobId dedupe. Never throws.
  await emitAutomationEvent("order.status_changed", row.id, { dedupeSuffix: to });
  return { kind: "ok", order: result.order, from: order.status };
}

/**
 * Persists a mutated Order back (the bulk-actions store contract):
 * scalar fields the bulk actions touch (status/courier/trackingId),
 * any history entries appended beyond what the DB already holds, and
 * tag additions/removals. Callers obtain the mutated order from the
 * state machine (transitionOrder) or from a booking/tag mutation —
 * this function never decides a status itself.
 */
export async function saveOrder(order: Order): Promise<void> {
  const row = await prisma.order.findUnique({
    where: { id: order.id },
    include: { history: { orderBy: { createdAt: "asc" } }, tags: true },
  });
  if (!row) throw new Error(`saveOrder: order not found: ${order.id}`);
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: order.status,
        courier: order.courier ?? null,
        trackingId: order.trackingId ?? null,
        paymentStatus: order.paymentStatus,
        riskScore: order.riskScore,
      },
    });
    const newEntries = order.history.slice(row.history.length);
    for (const entry of newEntries) {
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          from: entry.from,
          to: entry.to,
          changedById: await resolveUserId(entry.changedBy),
          reason: entry.reason ?? null,
        },
      });
    }
    const existingTags = new Set(row.tags.map((t) => t.tag));
    for (const tag of order.tags) {
      if (!existingTags.has(tag)) {
        await tx.orderTag.create({ data: { orderId: order.id, tag } });
      }
    }
    const wantedTags = new Set(order.tags);
    for (const t of row.tags) {
      if (!wantedTags.has(t.tag)) {
        await tx.orderTag.delete({ where: { id: t.id } });
      }
    }
  });
  // Bulk actions persist through here, not applyOrderTransition: when
  // THIS save moved the stored status INTO DELIVERED, run the same
  // delivered-order fan-out (exactly-once is enforced inside the
  // credit functions; see src/orders/delivered-hooks.ts).
  if (row.status !== "DELIVERED" && order.status === "DELIVERED") {
    await runDeliveredOrderHooks(order.id);
  }
  // Wave 15: same bundle-reserve release on the bulk-actions path.
  // Wave 19 (plan 17, O1): same general release as the single-order
  // funnel — one release path for both funnels.
  if (row.status !== "CANCELLED" && order.status === "CANCELLED") {
    await restoreBundleComponentsForOrder(order.id);
    await releaseOrderStockReservations(order.id);
  }
  // Wave 18 (plan 17, O0): same reversal engine on the bulk-actions
  // path — only when THIS save moved the stored status INTO a reversal
  // state (the hook itself is idempotent, the guard keeps unrelated
  // saves from re-entering it).
  if (
    row.status !== order.status &&
    (order.status === "CANCELLED" || order.status === "RETURNED" || order.status === "REFUNDED")
  ) {
    await runReversalHooks(order.id);
  }
}

/* ------------------------------------------------------------------ */
/* Order-paid funnel (payment status)                                  */
/* ------------------------------------------------------------------ */

/** Where a payment confirmation came from. Recorded for tracing only;
 *  it never influences the computed status. */
export type OrderPaymentSource =
  | "manual_trx_review"
  | "gateway_verify"
  | "payment_webhook"
  | "gateway_refund"
  | "refund_workbench"
  // Doc 17 O7-2: the returned-goods credit recorded as a Payment on
  // an exchange replacement order (src/orders/exchange.ts).
  | "exchange_credit"
  // Doc 17 O9-1: the already-paid preorder deposit recorded as a
  // credit Payment on the fulfilment order (src/orders/convert.ts).
  | "preorder_deposit";

export interface MarkOrderPaymentInput {
  /**
   * The caller's claim about the outcome — accepted for signature
   * compatibility with the confirmation points, but NEVER trusted:
   * the persisted status is always recomputed from the rows below.
   */
  paymentStatus?: PaymentStatus;
  source: OrderPaymentSource;
  /** Submission id / payment-attempt id / webhook idempotency key. */
  reference?: string;
}

export interface MarkOrderPaymentResult {
  orderId: string;
  orderNo: string;
  previousPaymentStatus: PaymentStatus;
  paymentStatus: PaymentStatus;
  /** Net paid (gross paid minus refunded), integer poisha. */
  paidPoisha: number;
  refundedPoisha: number;
  totalPoisha: number;
  /** True when the recomputed status equalled the stored one — the
   *  call changed nothing (idempotent replay / duplicate confirm). */
  alreadyApplied: boolean;
  /** True only when THIS call moved the order into PAID (and the
   *  payment.succeeded event was published). */
  transitionedToPaid: boolean;
  /** Advance state after this call (wave 21): true when the order's
   *  advance requirement is satisfied (stamped earlier or by this
   *  call); false when no requirement exists or it is still short. */
  advanceSatisfied: boolean;
}

/**
 * THE order-paid funnel — the only function that derives and writes
 * Order.paymentStatus from payment facts. Every confirmation point
 * (manual TrxID review approve, gateway verify, verified payment
 * webhook, gateway refund) persists its payment side FIRST, then
 * calls this; the status is recomputed here from persisted rows:
 *
 *   grossPaid = SUM(Payment.paidPoisha for the order)
 *             + SUM(APPROVED ManualTrxSubmission.amountPoisha)
 *   refunded  = SUM(Refund.amountPoisha for the order)
 *
 * (The two paid sources are disjoint by construction: gateway money
 * lands in Payment.paidPoisha via applyAttemptStatus, manual-TrxID
 * money exists only as APPROVED submission rows — the review never
 * copies it into a Payment row. The Refund sum matches how the
 * payments module itself derives refunded totals in db-store.ts.)
 *
 * Derivation (existing PaymentStatus semantics):
 *   refunded >= grossPaid (and grossPaid > 0) -> REFUNDED
 *   refunded > 0                              -> PARTIALLY_REFUNDED
 *   netPaid >= totalPoisha                    -> PAID
 *   netPaid > 0                               -> PARTIAL
 *   otherwise                                 -> UNPAID
 *
 * IDEMPOTENT: a second call with the same persisted facts recomputes
 * the same status, writes nothing (the write is guarded on the
 * previously-read status), and reports alreadyApplied: true.
 * Order.status (fulfilment) is NEVER touched here — the state machine
 * owns it. payment.succeeded is published AFTER the transaction
 * commits, only on the transition into PAID.
 *
 * ADVANCE (wave 21, doc 17 batch O3): this funnel is also where the
 * persisted advance requirement is satisfied — the first call whose
 * recomputed grossPaid reaches Order.advanceRequiredPoisha stamps
 * Order.advanceSatisfiedAt (+ timeline note) in the same transaction,
 * guarded so it happens exactly once. That stamp is what unlocks the
 * CONFIRMED gate in applyOrderTransition.
 *
 * Returns null when the order does not exist (callers have already
 * resolved the order through the payments layer, so this is a
 * defensive path, not an expected one).
 */
export async function markOrderPayment(
  orderId: string,
  input: MarkOrderPaymentInput,
): Promise<MarkOrderPaymentResult | null> {
  void input; // claim/source/reference are tracing context, never inputs to the math
  const order = await prisma.order.findFirst({
    where: { deletedAt: null, OR: [{ id: orderId }, { orderNo: orderId }] },
    select: {
      id: true,
      orderNo: true,
      paymentStatus: true,
      totalPoisha: true,
      advanceRequiredPoisha: true,
      advanceSatisfiedAt: true,
    },
  });
  if (!order) return null;
  const previous = order.paymentStatus as PaymentStatus;

  const outcome = await prisma.$transaction(async (tx) => {
    const [paymentAgg, manualAgg, refundAgg] = await Promise.all([
      tx.payment.aggregate({
        where: { orderId: order.id, deletedAt: null },
        _sum: { paidPoisha: true },
      }),
      tx.manualTrxSubmission.aggregate({
        where: { orderId: order.id, status: "APPROVED" },
        _sum: { amountPoisha: true },
      }),
      tx.refund.aggregate({
        // Only money-moved refunds count: workbench rows still PENDING (or
        // CANCELLED) must not read as refunded money. The sandbox gateway's
        // COMPLETED rows are money-moved. Mirrored in reversal-hooks.ts.
        where: { orderId: order.id, status: { in: ["SENT", "CONFIRMED", "COMPLETED"] } },
        _sum: { amountPoisha: true },
      }),
    ]);
    const grossPaid = (paymentAgg._sum.paidPoisha ?? 0) + (manualAgg._sum.amountPoisha ?? 0);
    const refunded = refundAgg._sum.amountPoisha ?? 0;
    const netPaid = grossPaid - refunded;
    const derived: PaymentStatus =
      grossPaid > 0 && refunded >= grossPaid
        ? "REFUNDED"
        : refunded > 0
          ? "PARTIALLY_REFUNDED"
          : order.totalPoisha > 0 && netPaid >= order.totalPoisha
            ? "PAID"
            : netPaid > 0
              ? "PARTIAL"
              : "UNPAID";
    let wrote = false;
    if (derived !== previous) {
      // Guarded on the status we read: a concurrent funnel call that
      // already applied the same derivation wins, this one becomes
      // the idempotent replay (count 0, no write, no event).
      const res = await tx.order.updateMany({
        where: { id: order.id, paymentStatus: order.paymentStatus },
        data: { paymentStatus: derived },
      });
      wrote = res.count === 1;
    }
    // Advance satisfaction (wave 21, doc 17 batch O3): the first time
    // cumulative paid money (grossPaid — the same Σ Payment.paidPoisha
    // + Σ APPROVED manual-Trx definition the refund workbench uses)
    // reaches the persisted requirement, stamp advanceSatisfiedAt and
    // leave a timeline note, in this same transaction. The update is
    // guarded on advanceSatisfiedAt still being null, so replays and
    // later payments never re-stamp or duplicate the note.
    let advanceSatisfiedNow = false;
    if (
      order.advanceRequiredPoisha > 0 &&
      !order.advanceSatisfiedAt &&
      grossPaid >= order.advanceRequiredPoisha
    ) {
      const res = await tx.order.updateMany({
        where: { id: order.id, advanceSatisfiedAt: null },
        data: { advanceSatisfiedAt: new Date() },
      });
      advanceSatisfiedNow = res.count === 1;
      if (advanceSatisfiedNow) {
        await tx.orderNote.create({
          data: {
            orderId: order.id,
            authorId: null,
            text: `অগ্রিম পেমেন্ট সম্পূর্ণ হয়েছে: প্রয়োজনীয় ${order.advanceRequiredPoisha} পয়সার বিপরীতে মোট ${grossPaid} পয়সা পরিশোধিত — অর্ডার এখন নিশ্চিত করা যাবে। / Advance payment satisfied: ${grossPaid} poisha paid against the required ${order.advanceRequiredPoisha} poisha — the order can now be confirmed.`,
          },
        });
      }
    }
    return { derived, grossPaid, refunded, netPaid, wrote, advanceSatisfiedNow };
  });

  const transitionedToPaid = outcome.wrote && previous !== "PAID" && outcome.derived === "PAID";
  if (transitionedToPaid) {
    publishPaymentSucceeded({
      id: order.id,
      orderNo: order.orderNo,
      paidPoisha: outcome.netPaid,
      totalPoisha: order.totalPoisha,
    });
    // Digital fulfilment (wave 15, module.product_types): download
    // grants + license keys are issued on PAID — digital goods
    // deliver on payment, not on the physical DELIVERED transition.
    // The fulfilment function is flag-gated and never throws, so a
    // fulfilment failure can never fail the payment itself.
    await runDigitalFulfilmentForOrder(order.id);
    // Automation lifecycle (ADV-7): payment.succeeded rules (e.g. the
    // high-value-paid example rule) evaluate on the transition INTO
    // PAID only — the same seam as the event-bus publish above.
    // Never throws.
    await emitAutomationEvent("payment.succeeded", order.id);
    // ERP auto-posting (ADV-11): the revenue + delivery + recorded-VAT
    // journal entry posts on this same exactly-once transition, gated
    // on module.erp_lite inside the service. Never throws.
    await postOrderPaidErp(order.id);
  }
  return {
    orderId: order.id,
    orderNo: order.orderNo,
    previousPaymentStatus: previous,
    paymentStatus: outcome.derived,
    paidPoisha: outcome.netPaid,
    refundedPoisha: outcome.refunded,
    totalPoisha: order.totalPoisha,
    alreadyApplied: !outcome.wrote,
    transitionedToPaid,
    advanceSatisfied:
      order.advanceRequiredPoisha > 0 &&
      (order.advanceSatisfiedAt !== null || outcome.advanceSatisfiedNow),
  };
}

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

interface CustomerAggregate {
  totalOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  returnedOrders: number;
  lifetimeValuePoisha: number;
  lastOrderAt?: string;
}

async function aggregatesForCustomers(
  customerIds: string[],
): Promise<Map<string, CustomerAggregate>> {
  const result = new Map<string, CustomerAggregate>();
  if (customerIds.length === 0) return result;
  for (const id of customerIds) {
    result.set(id, {
      totalOrders: 0,
      deliveredOrders: 0,
      cancelledOrders: 0,
      returnedOrders: 0,
      lifetimeValuePoisha: 0,
    });
  }
  const byStatus = await prisma.order.groupBy({
    by: ["customerId", "status"],
    where: { customerId: { in: customerIds }, deletedAt: null },
    _count: { _all: true },
  });
  for (const g of byStatus) {
    const agg = result.get(g.customerId);
    if (!agg) continue;
    agg.totalOrders += g._count._all;
    if (g.status === "DELIVERED") agg.deliveredOrders = g._count._all;
    if (g.status === "CANCELLED") agg.cancelledOrders = g._count._all;
    if (g.status === "RETURNED") agg.returnedOrders = g._count._all;
  }
  const deliveredValue = await prisma.order.groupBy({
    by: ["customerId"],
    where: { customerId: { in: customerIds }, deletedAt: null, status: "DELIVERED" },
    _sum: { totalPoisha: true },
  });
  for (const g of deliveredValue) {
    const agg = result.get(g.customerId);
    if (agg) agg.lifetimeValuePoisha = g._sum.totalPoisha ?? 0;
  }
  const lastOrder = await prisma.order.groupBy({
    by: ["customerId"],
    where: { customerId: { in: customerIds }, deletedAt: null },
    _max: { createdAt: true },
  });
  for (const g of lastOrder) {
    const agg = result.get(g.customerId);
    if (agg && g._max.createdAt) agg.lastOrderAt = g._max.createdAt.toISOString();
  }
  return result;
}

type CustomerRow = Awaited<ReturnType<typeof prisma.customer.findFirst>>;

function customerRowToCustomer(
  row: NonNullable<CustomerRow>,
  agg: CustomerAggregate,
): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    ...(row.email ? { email: row.email } : {}),
    totalOrders: agg.totalOrders,
    deliveredOrders: agg.deliveredOrders,
    cancelledOrders: agg.cancelledOrders,
    returnedOrders: agg.returnedOrders,
    lifetimeValuePoisha: agg.lifetimeValuePoisha,
    ...(agg.lastOrderAt ? { lastOrderAt: agg.lastOrderAt } : {}),
    tags: row.tags,
    blocked: row.blocked,
  };
}

export interface CustomerListFilters {
  search?: string;
  tag?: string;
  blocked?: boolean;
  page: number;
  pageSize: number;
}

export async function listCustomers(
  filters: CustomerListFilters,
): Promise<{ rows: Customer[]; total: number }> {
  const where: Record<string, unknown> = { deletedAt: null };
  if (filters.tag) where.tags = { has: filters.tag };
  if (filters.blocked !== undefined) where.blocked = filters.blocked;
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { phone: { contains: filters.search } },
    ];
  }
  const [total, rows] = await Promise.all([
    prisma.customer.count({ where: where as never }),
    prisma.customer.findMany({
      where: where as never,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);
  const aggregates = await aggregatesForCustomers(rows.map((r) => r.id));
  return {
    rows: rows.map((r) =>
      customerRowToCustomer(
        r,
        aggregates.get(r.id) ?? {
          totalOrders: 0,
          deliveredOrders: 0,
          cancelledOrders: 0,
          returnedOrders: 0,
          lifetimeValuePoisha: 0,
        },
      ),
    ),
    total,
  };
}

export async function getCustomerWithOrders(
  id: string,
): Promise<{ customer: Customer; orders: Order[] } | null> {
  const row = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
  if (!row) return null;
  const aggregates = await aggregatesForCustomers([row.id]);
  const orderRows = await prisma.order.findMany({
    where: { customerId: row.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: ORDER_INCLUDE,
  });
  return {
    customer: customerRowToCustomer(
      row,
      aggregates.get(row.id) ?? {
        totalOrders: 0,
        deliveredOrders: 0,
        cancelledOrders: 0,
        returnedOrders: 0,
        lifetimeValuePoisha: 0,
      },
    ),
    orders: orderRows.map(orderRowToOrder),
  };
}
