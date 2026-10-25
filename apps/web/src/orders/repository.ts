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
 *   advanceRequired, requiresOtp, couponStatus, rejected-coupon reason)
 *   have NO columns on Order. At create time the route builds the exact
 *   EnrichedOrder from the live assessment and returns it; this module
 *   persists what the schema supports (riskScore, discountPoisha, a
 *   CouponUsage row when the coupon exists in the DB) and can
 *   RECONSTRUCT the enrichment for a stored order: riskBand from
 *   riskLevel(riskScore), fraudAction from the scorer's documented
 *   bands (>=70 require_advance, 40-69 manual_review, <40 auto_confirm
 *   — "block" never reaches storage, it is a 422), requiresOtp =
 *   score >= 70, coupon outcome from the CouponUsage row. A coupon that
 *   was REJECTED at create leaves no DB trace, so a reconstructed
 *   replay reports couponStatus "none" — the create route keeps an
 *   in-process enrichment cache so same-process replays return the
 *   exact original outcome.
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
import { getSetting } from "../lib/settings";
import { riskLevel } from "./customer";
import { runDeliveredOrderHooks } from "./delivered-hooks";
import { publishPaymentSucceeded } from "./event-bus";
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
    paymentMethod: paymentMethodFromDb(row.paymentMethod),
    paymentStatus: row.paymentStatus as PaymentStatus,
    status: row.status as OrderStatus,
    ...(row.courier ? { courier: row.courier } : {}),
    ...(row.trackingId ? { trackingId: row.trackingId } : {}),
    riskScore: row.riskScore,
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
    advanceRequired: fraudAction === "require_advance",
    requiresOtp: score >= 70,
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
  page: number;
  pageSize: number;
}

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
    const needle = filters.search;
    where.OR = [
      { orderNo: { contains: needle, mode: "insensitive" } },
      { customerName: { contains: needle, mode: "insensitive" } },
      { customerPhone: { contains: needle } },
      { trackingId: { contains: needle, mode: "insensitive" } },
    ];
  }
  const [total, rows] = await Promise.all([
    prisma.order.count({ where: where as never }),
    prisma.order.findMany({
      where: where as never,
      orderBy: { createdAt: "desc" },
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
    include: { product: { select: { titleEn: true } } },
  });
  const map = new Map<string, ServerVariantSnapshot>();
  for (const v of variants) {
    map.set(v.id, {
      variantId: v.id,
      productName: v.product.titleEn,
      sku: v.sku,
      unitPricePoisha: v.pricePoisha,
      stock: v.stock,
    });
  }
  return map;
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
}

export type CreateOrderRecordResult =
  | {
      replayed: false;
      orderId: string;
      orderNo: string;
      createdAt: string;
      /** DB id of the checkout note row, when a note was supplied. */
      noteId: string | null;
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

async function nextOrderNo(): Promise<string> {
  const base = `ORD-${Date.now()}`;
  let candidate = base;
  let suffix = 2;
  // orderNo is UNIQUE; same-millisecond creates get a -2/-3 suffix
  // instead of colliding (the P2002 guard in createOrderRecord is the
  // backstop for the remaining race).
  while (await prisma.order.findUnique({ where: { orderNo: candidate }, select: { id: true } })) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
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
 * Stock reservation: the checkout path never called the inventory
 * ledger before this swap (stock was a read-only check), so nothing is
 * called now either — the inventory module's swap owns that wiring.
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
  const orderNo = await nextOrderNo();
  let noteId: string | null = null;
  try {
    const created = await prisma.$transaction(async (tx) => {
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
      await tx.orderStatusHistory.create({
        data: { orderId: order.id, from: null, to: "PENDING", changedById: null },
      });
      if (input.note) {
        const note = await tx.orderNote.create({
          data: { orderId: order.id, authorId: null, text: input.note },
        });
        noteId = note.id;
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
      return order;
    });
    return {
      replayed: false,
      orderId: created.id,
      orderNo: created.orderNo,
      createdAt: created.createdAt.toISOString(),
      noteId,
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
  | { kind: "invalid"; error: string };

/**
 * Loads the order, decides the transition with the state machine (the
 * single authority — it also publishes order.status_changed on its
 * success branch), then persists status + the appended history row in
 * one transaction. An invalid transition writes NOTHING.
 */
export async function applyOrderTransition(
  idOrNo: string,
  to: OrderStatus,
  changedBy: string,
  reason?: string,
): Promise<ApplyTransitionResult> {
  const row = await findOrderRowByIdOrNo(idOrNo);
  if (!row) return { kind: "not_found" };
  const order = orderRowToOrder(row);
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
  // Delivered-order fan-out (loyalty EARN + referral reward, reseller
  // wallet credit, vendor commission lines) — only on the transition
  // INTO DELIVERED, after the status commit. The hook never throws, so
  // a credit failure can never fail the delivery itself; every credit
  // is idempotent per order (see src/orders/delivered-hooks.ts).
  if (to === "DELIVERED") {
    await runDeliveredOrderHooks(row.id);
  }
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
  | "gateway_refund";

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
    select: { id: true, orderNo: true, paymentStatus: true, totalPoisha: true },
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
        where: { orderId: order.id },
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
    return { derived, grossPaid, refunded, netPaid, wrote };
  });

  const transitionedToPaid = outcome.wrote && previous !== "PAID" && outcome.derived === "PAID";
  if (transitionedToPaid) {
    publishPaymentSucceeded({
      id: order.id,
      orderNo: order.orderNo,
      paidPoisha: outcome.netPaid,
      totalPoisha: order.totalPoisha,
    });
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
