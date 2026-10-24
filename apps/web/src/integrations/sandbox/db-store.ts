// Prisma-backed persistence for the sandbox integration layer — DB swap
// (2026-10-24). This module replaces the process-local Maps that used to
// live in ./store.ts. The sandbox ADAPTERS stay sandbox (SBX- ids, no
// real provider calls, simulated results); only the STORAGE changed:
// payment attempts, payments, refunds, manual TrxID submissions,
// shipments and shipment events now persist in the real tables
// (Payment / PaymentAttempt / Refund / ManualTrxSubmission / Shipment /
// ShipmentEvent) behind the exact TS shapes the rest of the app already
// consumes (SandboxPaymentAttempt / SandboxShipment /
// ManualTrxSubmission).
//
// Invariants carried over from the in-memory store:
//  - Idempotency: a sandbox attempt/shipment id is deterministic from
//    (provider, idempotencyKey); a replay returns the stored row instead
//    of creating a second one. DB backstops: PaymentAttempt.idempotencyKey
//    UNIQUE, Shipment.trackingId UNIQUE, ManualTrxSubmission
//    UNIQUE(method, trxId), ShipmentEvent.idempotencyKey UNIQUE.
//  - Money is integer poisha everywhere. Refunded totals are DERIVED
//    from Refund rows (PaymentAttempt has no refundedPoisha column).
//  - FK reality: Payment / ManualTrxSubmission / Shipment rows reference
//    the Order table. Callers pass an order id OR orderNo; it is resolved
//    to the Order row here (read-only lookup — this module never writes
//    order state; the orders module owns that). An unresolvable order is
//    a hard error (SandboxOrderNotFoundError), never a silent orphan.
//
// SCHEMA DRIFT (reported, worked around — schema.prisma NOT changed):
//  - There is NO webhook_logs table, so the webhook attempt log and the
//    payment-channel idempotency RESULTS stay process-local (see
//    ./store.ts webhookMemory). Courier webhooks additionally persist a
//    ShipmentEvent with the webhook idempotency key (UNIQUE backstop).
//  - PaymentAttempt has no refundedPoisha column: refunds are Refund
//    rows and the refunded total is their sum (see mapper inputs).
import { prisma } from "@advance-ecommerce/db";
import type { ManualTrxSubmission, PaymentStatus } from "../payment";
import type { ShipmentStatus } from "../courier";
import type { OrderStatus } from "../../orders/types";
import type { SandboxPaymentAttempt, SandboxShipment } from "./store";
import { normalizeTrxId } from "./store";

export class SandboxOrderNotFoundError extends Error {
  readonly code = "ORDER_NOT_FOUND";
  constructor(orderRef: string) {
    super(`Order not found for payment/shipment persistence: ${orderRef}`);
    this.name = "SandboxOrderNotFoundError";
  }
}

/* ------------------------------------------------------------------ */
/* Enum mapping (TS lowercase method strings <-> schema enums)         */
/* ------------------------------------------------------------------ */

const METHOD_TO_ENUM: Record<string, string> = {
  bkash: "BKASH",
  nagad: "NAGAD",
  sslcommerz: "SSLCOMMERZ",
  rocket: "ROCKET",
  upay: "UPAY",
  cod: "COD",
  card: "CARD",
};

const ENUM_TO_METHOD: Record<string, string> = Object.fromEntries(
  Object.entries(METHOD_TO_ENUM).map(([k, v]) => [v, k]),
);

export function paymentMethodToEnum(method: string): string {
  return METHOD_TO_ENUM[method] ?? method.toUpperCase();
}

export function paymentMethodFromEnum(value: string): string {
  return ENUM_TO_METHOD[value] ?? value.toLowerCase();
}

type PrismaPaymentMethod = NonNullable<Parameters<typeof prisma.payment.create>[0]["data"]["method"]>;
type PrismaPaymentStatus = NonNullable<Parameters<typeof prisma.payment.create>[0]["data"]["status"]>;
type PrismaShipmentStatus = NonNullable<Parameters<typeof prisma.shipment.create>[0]["data"]["status"]>;
type PrismaManualStatus = NonNullable<
  Parameters<typeof prisma.manualTrxSubmission.create>[0]["data"]["status"]
>;

const methodEnum = (m: string) => paymentMethodToEnum(m) as PrismaPaymentMethod;
const statusEnum = (s: PaymentStatus) => s as PrismaPaymentStatus;
const shipmentStatusEnum = (s: ShipmentStatus) => s as PrismaShipmentStatus;

/* ------------------------------------------------------------------ */
/* Order resolution (read-only; orders module owns order writes)       */
/* ------------------------------------------------------------------ */

export interface ResolvedOrderRef {
  id: string;
  orderNo: string;
  status: OrderStatus;
}

export async function resolveOrderRef(orderRef: string): Promise<ResolvedOrderRef | null> {
  const row = await prisma.order.findFirst({
    where: { OR: [{ id: orderRef }, { orderNo: orderRef }] },
    select: { id: true, orderNo: true, status: true },
  });
  if (!row) return null;
  return { id: row.id, orderNo: row.orderNo, status: row.status as OrderStatus };
}

export async function requireOrderRef(orderRef: string): Promise<ResolvedOrderRef> {
  const resolved = await resolveOrderRef(orderRef);
  if (!resolved) throw new SandboxOrderNotFoundError(orderRef);
  return resolved;
}

/* ------------------------------------------------------------------ */
/* Payment attempts                                                    */
/* ------------------------------------------------------------------ */

interface PaymentAttemptRowShape {
  id: string;
  orderId: string;
  method: string;
  amountPoisha: number;
  status: string;
  gatewayTransactionId: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
}

/**
 * Map a PaymentAttempt row to the sandbox shape. paidPoisha lives on the
 * Payment parent (the money aggregate) and refundedPoisha is derived
 * from Refund rows, so both are passed in by the loaders.
 */
export function attemptRowToSandbox(
  row: PaymentAttemptRowShape,
  paidPoisha: number,
  refundedPoisha: number,
): SandboxPaymentAttempt {
  return {
    attemptId: row.id,
    method: paymentMethodFromEnum(row.method),
    orderId: row.orderId,
    amountPoisha: row.amountPoisha,
    paidPoisha,
    refundedPoisha,
    gatewayTransactionId: row.gatewayTransactionId ?? "",
    idempotencyKey: row.idempotencyKey ?? "",
    status: row.status as PaymentStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadAttempt(attemptId: string): Promise<SandboxPaymentAttempt | null> {
  const row = await prisma.paymentAttempt.findUnique({
    where: { id: attemptId },
    include: { payment: true },
  });
  if (!row) return null;
  const refundAgg = await prisma.refund.aggregate({
    where: { paymentId: row.paymentId },
    _sum: { amountPoisha: true },
  });
  return attemptRowToSandbox(row, row.payment.paidPoisha, refundAgg._sum.amountPoisha ?? 0);
}

export async function findAttemptById(attemptId: string): Promise<SandboxPaymentAttempt | null> {
  return loadAttempt(attemptId);
}

export async function listAttempts(): Promise<SandboxPaymentAttempt[]> {
  const rows = await prisma.paymentAttempt.findMany({
    include: { payment: true },
    orderBy: { createdAt: "asc" },
  });
  if (rows.length === 0) return [];
  const refundSums = await prisma.refund.groupBy({
    by: ["paymentId"],
    where: { paymentId: { in: rows.map((r) => r.paymentId) } },
    _sum: { amountPoisha: true },
  });
  const byPayment = new Map(refundSums.map((s) => [s.paymentId, s._sum.amountPoisha ?? 0]));
  return rows.map((row) =>
    attemptRowToSandbox(row, row.payment.paidPoisha, byPayment.get(row.paymentId) ?? 0),
  );
}

/**
 * Find-or-create the Payment parent + PaymentAttempt for a sandbox
 * gateway initiation. Replay of the same (method, idempotencyKey)
 * returns the existing attempt — the deterministic attempt id is the
 * primary key, PaymentAttempt.idempotencyKey UNIQUE is the backstop.
 */
export async function getOrCreateAttempt(input: {
  method: string;
  orderRef: string;
  amountPoisha: number;
  attemptId: string;
  gatewayTransactionId: string;
  idempotencyKey: string;
}): Promise<SandboxPaymentAttempt> {
  const existing = await loadAttempt(input.attemptId);
  if (existing) return existing;
  const byKey = await prisma.paymentAttempt.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (byKey) {
    const replay = await loadAttempt(byKey.id);
    if (replay) return replay;
  }
  const order = await requireOrderRef(input.orderRef);
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      method: methodEnum(input.method),
      amountPoisha: input.amountPoisha,
      paidPoisha: 0,
      status: statusEnum("UNPAID"),
      gatewayTransactionId: input.gatewayTransactionId,
    },
  });
  try {
    const row = await prisma.paymentAttempt.create({
      data: {
        id: input.attemptId,
        paymentId: payment.id,
        orderId: order.id,
        method: methodEnum(input.method),
        amountPoisha: input.amountPoisha,
        status: statusEnum("UNPAID"),
        gatewayTransactionId: input.gatewayTransactionId,
        idempotencyKey: input.idempotencyKey,
      },
      include: { payment: true },
    });
    return attemptRowToSandbox(row, row.payment.paidPoisha, 0);
  } catch (err) {
    // Unique backstop fired (concurrent replay): return the winner.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      const winner = (await loadAttempt(input.attemptId)) ?? null;
      if (winner) return winner;
    }
    throw err;
  }
}

/**
 * Apply a payment status to an attempt AND its Payment parent in one
 * transaction. paidPoisha, when given, is written to the Payment parent
 * (the money aggregate); the attempt row carries status only, matching
 * how loaders reconstruct SandboxPaymentAttempt.
 */
export async function applyAttemptStatus(
  attemptId: string,
  status: PaymentStatus,
  paidPoisha?: number,
): Promise<SandboxPaymentAttempt | null> {
  const row = await prisma.paymentAttempt.findUnique({
    where: { id: attemptId },
    select: { id: true, paymentId: true },
  });
  if (!row) return null;
  await prisma.$transaction([
    prisma.paymentAttempt.update({
      where: { id: attemptId },
      data: { status: statusEnum(status) },
    }),
    prisma.payment.update({
      where: { id: row.paymentId },
      data: {
        status: statusEnum(status),
        ...(paidPoisha !== undefined ? { paidPoisha } : {}),
      },
    }),
  ]);
  return loadAttempt(attemptId);
}

/** Sum of Refund rows for the Payment parent of an attempt. */
export async function refundedTotalForAttempt(attemptId: string): Promise<number> {
  const row = await prisma.paymentAttempt.findUnique({
    where: { id: attemptId },
    select: { paymentId: true },
  });
  if (!row) return 0;
  const agg = await prisma.refund.aggregate({
    where: { paymentId: row.paymentId },
    _sum: { amountPoisha: true },
  });
  return agg._sum.amountPoisha ?? 0;
}

/**
 * Record a refund against an attempt (a Refund row on its Payment
 * parent) and move attempt + payment to REFUNDED / PARTIALLY_REFUNDED.
 * Returns the new refunded total. Caller enforces the paid cap first.
 */
export async function recordRefund(input: {
  attemptId: string;
  amountPoisha: number;
  reason: string;
}): Promise<{ status: PaymentStatus; refundedPoisha: number } | null> {
  const attempt = await loadAttempt(input.attemptId);
  if (!attempt) return null;
  const row = await prisma.paymentAttempt.findUnique({
    where: { id: input.attemptId },
    select: { paymentId: true },
  });
  if (!row) return null;
  await prisma.refund.create({
    data: {
      paymentId: row.paymentId,
      orderId: attempt.orderId,
      amountPoisha: input.amountPoisha,
      reason: input.reason,
      method: methodEnum(attempt.method),
      status: "COMPLETED",
    },
  });
  const refundedPoisha = attempt.refundedPoisha + input.amountPoisha;
  const status: PaymentStatus =
    refundedPoisha >= attempt.paidPoisha ? "REFUNDED" : "PARTIALLY_REFUNDED";
  await applyAttemptStatus(input.attemptId, status);
  const after = await loadAttempt(input.attemptId);
  return { status, refundedPoisha: after?.refundedPoisha ?? refundedPoisha };
}

/* ------------------------------------------------------------------ */
/* Manual TrxID submissions                                            */
/* ------------------------------------------------------------------ */

interface ManualRowShape {
  id: string;
  orderId: string;
  method: string;
  trxId: string;
  senderPhone: string;
  amountPoisha: number;
  status: string;
  reviewedById: string | null;
  reviewNote: string | null;
  submittedAt: Date;
}

export function manualRowToSubmission(row: ManualRowShape): ManualTrxSubmission {
  return {
    id: row.id,
    orderId: row.orderId,
    method: paymentMethodFromEnum(row.method) as ManualTrxSubmission["method"],
    trxId: row.trxId,
    senderPhone: row.senderPhone,
    amountPoisha: row.amountPoisha,
    status: (row.status as string).toLowerCase() as ManualTrxSubmission["status"],
    reviewedById: row.reviewedById,
    reviewNote: row.reviewNote,
    submittedAt: row.submittedAt.toISOString(),
  };
}

export async function findManualTrxByMethodAndTrxDb(
  method: ManualTrxSubmission["method"],
  trxId: string,
): Promise<ManualTrxSubmission | null> {
  const row = await prisma.manualTrxSubmission.findUnique({
    where: { method_trxId: { method: methodEnum(method), trxId: normalizeTrxId(trxId) } },
  });
  return row ? manualRowToSubmission(row) : null;
}

export async function createManualTrxRow(input: {
  id: string;
  orderRef: string;
  method: ManualTrxSubmission["method"];
  trxId: string;
  senderPhone: string;
  amountPoisha: number;
}): Promise<ManualTrxSubmission> {
  const order = await requireOrderRef(input.orderRef);
  const row = await prisma.manualTrxSubmission.create({
    data: {
      id: input.id,
      orderId: order.id,
      method: methodEnum(input.method),
      trxId: normalizeTrxId(input.trxId),
      senderPhone: input.senderPhone,
      amountPoisha: input.amountPoisha,
      status: "PENDING" as PrismaManualStatus,
    },
  });
  return manualRowToSubmission(row);
}

export async function getManualTrxById(id: string): Promise<ManualTrxSubmission | null> {
  const row = await prisma.manualTrxSubmission.findUnique({ where: { id } });
  return row ? manualRowToSubmission(row) : null;
}

export async function findApprovedManualTrx(
  method: ManualTrxSubmission["method"],
  trxId: string,
  exceptId: string,
): Promise<ManualTrxSubmission | null> {
  const row = await prisma.manualTrxSubmission.findFirst({
    where: {
      method: methodEnum(method),
      trxId: normalizeTrxId(trxId),
      status: "APPROVED" as PrismaManualStatus,
      id: { not: exceptId },
    },
  });
  return row ? manualRowToSubmission(row) : null;
}

export async function updateManualTrxReview(
  id: string,
  status: "approved" | "rejected",
  reviewerId: string,
  note: string,
): Promise<ManualTrxSubmission> {
  const row = await prisma.manualTrxSubmission.update({
    where: { id },
    data: {
      status: (status === "approved" ? "APPROVED" : "REJECTED") as PrismaManualStatus,
      reviewedById: reviewerId,
      reviewNote: note,
      reviewedAt: new Date(),
    },
  });
  return manualRowToSubmission(row);
}

export async function listManualTrxDb(
  status?: ManualTrxSubmission["status"],
): Promise<ManualTrxSubmission[]> {
  const rows = await prisma.manualTrxSubmission.findMany({
    where: status
      ? { status: (status === "pending" ? "PENDING" : status === "approved" ? "APPROVED" : "REJECTED") as PrismaManualStatus }
      : undefined,
    orderBy: { submittedAt: "asc" },
  });
  return rows.map(manualRowToSubmission);
}

/* ------------------------------------------------------------------ */
/* Shipments                                                           */
/* ------------------------------------------------------------------ */

interface ShipmentRowShape {
  id: string;
  orderId: string;
  provider: string;
  trackingId: string | null;
  codAmountPoisha: number;
  weightGrams: number | null;
  status: string;
  createdAt: Date;
  events: { status: string; idempotencyKey: string | null; createdAt: Date }[];
  order: { status: string } | null;
}

export function shipmentRowToSandbox(row: ShipmentRowShape): SandboxShipment {
  const events = [...row.events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return {
    shipmentId: row.id,
    trackingId: row.trackingId ?? "",
    provider: row.provider,
    orderId: row.orderId,
    codAmountPoisha: row.codAmountPoisha,
    weightGrams: row.weightGrams ?? 0,
    status: row.status as ShipmentStatus,
    statusHistory: events.map((e) => e.status as ShipmentStatus),
    orderStatus: (row.order?.status as OrderStatus) ?? "PENDING",
    idempotencyKey: events[0]?.idempotencyKey?.startsWith("booking:")
      ? events[0].idempotencyKey.slice("booking:".length)
      : "",
    createdAt: row.createdAt.toISOString(),
  };
}

const shipmentInclude = {
  events: true,
  order: { select: { status: true } },
} as const;

export async function findShipmentById(shipmentId: string): Promise<SandboxShipment | null> {
  const row = await prisma.shipment.findUnique({ where: { id: shipmentId }, include: shipmentInclude });
  return row ? shipmentRowToSandbox(row) : null;
}

export async function findShipmentByTracking(
  trackingId: string,
  provider: string,
): Promise<SandboxShipment | null> {
  const row = await prisma.shipment.findUnique({ where: { trackingId }, include: shipmentInclude });
  if (!row || row.provider !== provider) return null;
  return shipmentRowToSandbox(row);
}

export async function listShipments(provider?: string): Promise<SandboxShipment[]> {
  const rows = await prisma.shipment.findMany({
    where: provider ? { provider } : undefined,
    include: shipmentInclude,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(shipmentRowToSandbox);
}

/**
 * Create a shipment + its CREATED event in one transaction. chargePoisha
 * is the real courierChargePoisha() output computed by the caller (the
 * provider adapter owns the rate math; this layer only persists it).
 */
export async function createShipmentRow(input: {
  shipmentId: string;
  trackingId: string;
  provider: string;
  orderRef: string;
  codAmountPoisha: number;
  weightGrams: number;
  chargePoisha: number;
  idempotencyKey: string;
}): Promise<SandboxShipment> {
  const order = await requireOrderRef(input.orderRef);
  const row = await prisma.shipment.create({
    data: {
      id: input.shipmentId,
      orderId: order.id,
      provider: input.provider,
      trackingId: input.trackingId,
      status: shipmentStatusEnum("CREATED"),
      codAmountPoisha: input.codAmountPoisha,
      chargePoisha: input.chargePoisha,
      weightGrams: input.weightGrams,
      events: {
        create: {
          status: shipmentStatusEnum("CREATED"),
          idempotencyKey: `booking:${input.idempotencyKey}`,
        },
      },
    },
    include: shipmentInclude,
  });
  return shipmentRowToSandbox(row);
}

/**
 * Move a shipment to a new status and append a ShipmentEvent in one
 * transaction. `eventIdempotencyKey` (e.g. a courier webhook key) is
 * UNIQUE — a P2002 from the event insert is the DB backstop against a
 * replayed webhook applying twice; it propagates to the caller.
 */
export async function applyShipmentStatus(
  shipmentId: string,
  status: ShipmentStatus,
  opts?: { eventIdempotencyKey?: string; providerRawStatus?: string },
): Promise<SandboxShipment | null> {
  const existing = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true } });
  if (!existing) return null;
  await prisma.$transaction([
    prisma.shipment.update({
      where: { id: shipmentId },
      data: { status: shipmentStatusEnum(status) },
    }),
    prisma.shipmentEvent.create({
      data: {
        shipmentId,
        status: shipmentStatusEnum(status),
        providerRawStatus: opts?.providerRawStatus ?? null,
        idempotencyKey: opts?.eventIdempotencyKey ?? null,
      },
    }),
  ]);
  return findShipmentById(shipmentId);
}

/**
 * The chargePoisha stored on a Shipment row at booking time. The
 * SandboxShipment shape predates the stored-charge column and does not
 * carry it, so settlement/invoice code reads it through here.
 */
export async function findShipmentCharge(shipmentId: string): Promise<number> {
  const row = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: { chargePoisha: true },
  });
  return row?.chargePoisha ?? 0;
}

/** Has a courier webhook with this idempotency key already been applied? */
export async function findShipmentEventByIdempotencyKey(
  key: string,
): Promise<{ shipmentId: string; status: ShipmentStatus } | null> {
  const row = await prisma.shipmentEvent.findUnique({ where: { idempotencyKey: key } });
  if (!row) return null;
  return { shipmentId: row.shipmentId, status: row.status as ShipmentStatus };
}
