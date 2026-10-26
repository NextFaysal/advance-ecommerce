/**
 * Persistence for the LIVE bKash adapter — ADV-4.
 *
 * Attempts live in the SAME Payment / PaymentAttempt tables the sandbox
 * layer uses (src/integrations/sandbox/db-store.ts), and the shared
 * loaders/writers from that module (findAttemptById, applyAttemptStatus,
 * recordRefund) are reused unchanged — this file adds only what is
 * bKash-specific:
 *
 *  - createBkashAttempt: find-or-create keyed by the initiation
 *    idempotency key (`prepaid-<orderId>`), BEFORE any gateway call —
 *    bKash's paymentID does not exist yet at row-creation time, so the
 *    row starts with gatewayTransactionId null (the sandbox store's
 *    getOrCreateAttempt cannot express that; it demands the simulated
 *    gateway id up front).
 *  - setAttemptCreated: after bKash create-payment succeeds, the
 *    attempt's gatewayTransactionId becomes the bKash **paymentID** —
 *    the handle the customer callback presents and verify() compares,
 *    mirroring the sandbox contract. The bkashURL is kept in
 *    gatewayResponseRef until execution so an initiation replay can
 *    return the same redirect.
 *  - setAttemptExecuted: after a successful execute, gatewayResponseRef
 *    is replaced by the bKash **trxID** and the Payment parent's
 *    gatewayTransactionId becomes the trxID (the money's id of record).
 *    The refund call needs both ids: paymentID stays on the attempt,
 *    trxID is read back from gatewayResponseRef.
 *  - findBkashAttemptByPaymentId: the callback route's lookup.
 *
 * Money is integer poisha; the Payment parent remains the aggregate
 * (paidPoisha), exactly as the sandbox layer documents.
 */
import { prisma } from "@advance-ecommerce/db";
import {
  findAttemptById,
  paymentMethodToEnum,
  requireOrderRef,
} from "../sandbox/db-store";
import type { SandboxPaymentAttempt } from "../sandbox/store";

type PrismaPaymentMethod = NonNullable<Parameters<typeof prisma.payment.create>[0]["data"]["method"]>;
type PrismaPaymentStatus = NonNullable<Parameters<typeof prisma.payment.create>[0]["data"]["status"]>;

const bkashMethod = () => paymentMethodToEnum("bkash") as PrismaPaymentMethod;

export async function createBkashAttempt(input: {
  orderRef: string;
  amountPoisha: number;
  idempotencyKey: string;
}): Promise<SandboxPaymentAttempt> {
  const byKey = await prisma.paymentAttempt.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (byKey) {
    const replay = await findAttemptById(byKey.id);
    if (replay) return replay;
  }
  const order = await requireOrderRef(input.orderRef);
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      method: bkashMethod(),
      amountPoisha: input.amountPoisha,
      paidPoisha: 0,
      status: "UNPAID" as PrismaPaymentStatus,
      gatewayTransactionId: null,
    },
  });
  try {
    const row = await prisma.paymentAttempt.create({
      data: {
        paymentId: payment.id,
        orderId: order.id,
        method: bkashMethod(),
        amountPoisha: input.amountPoisha,
        status: "UNPAID" as PrismaPaymentStatus,
        gatewayTransactionId: null,
        idempotencyKey: input.idempotencyKey,
      },
    });
    const created = await findAttemptById(row.id);
    if (!created) throw new Error("bKash attempt vanished immediately after creation.");
    return created;
  } catch (err) {
    // Unique backstop fired (concurrent replay): return the winner.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      const winner = await prisma.paymentAttempt.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true },
      });
      if (winner) {
        const attempt = await findAttemptById(winner.id);
        if (attempt) return attempt;
      }
    }
    throw err;
  }
}

/** After create-payment: attempt.gatewayTransactionId = bKash paymentID,
 *  attempt.gatewayResponseRef = bkashURL (until execution replaces it). */
export async function setAttemptCreated(
  attemptId: string,
  paymentID: string,
  bkashURL: string,
): Promise<void> {
  const row = await prisma.paymentAttempt.findUnique({
    where: { id: attemptId },
    select: { paymentId: true },
  });
  if (!row) throw new Error("bKash attempt not found when recording the created payment.");
  await prisma.$transaction([
    prisma.paymentAttempt.update({
      where: { id: attemptId },
      data: { gatewayTransactionId: paymentID, gatewayResponseRef: bkashURL },
    }),
    prisma.payment.update({
      where: { id: row.paymentId },
      data: { gatewayTransactionId: paymentID },
    }),
  ]);
}

/** After a successful execute: trxID becomes the money's id of record —
 *  Payment.gatewayTransactionId = trxID, attempt.gatewayResponseRef =
 *  trxID (the refund call reads it from there; see header). */
export async function setAttemptExecuted(attemptId: string, trxID: string): Promise<void> {
  const row = await prisma.paymentAttempt.findUnique({
    where: { id: attemptId },
    select: { paymentId: true },
  });
  if (!row) throw new Error("bKash attempt not found when recording execution.");
  await prisma.$transaction([
    prisma.paymentAttempt.update({
      where: { id: attemptId },
      data: { gatewayResponseRef: trxID },
    }),
    prisma.payment.update({
      where: { id: row.paymentId },
      data: { gatewayTransactionId: trxID },
    }),
  ]);
}

/** Raw gatewayResponseRef for an attempt (bkashURL pre-execution,
 *  trxID post-execution) — the shared SandboxPaymentAttempt shape does
 *  not carry this column, so the gateway reads it here. */
export async function getAttemptGatewayResponseRef(attemptId: string): Promise<string | null> {
  const row = await prisma.paymentAttempt.findUnique({
    where: { id: attemptId },
    select: { gatewayResponseRef: true },
  });
  return row?.gatewayResponseRef ?? null;
}

/** The callback route's lookup: bKash paymentID -> attempt. */
export async function findBkashAttemptByPaymentId(
  paymentID: string,
): Promise<SandboxPaymentAttempt | null> {
  const row = await prisma.paymentAttempt.findFirst({
    where: { method: bkashMethod(), gatewayTransactionId: paymentID },
    select: { id: true },
  });
  if (!row) return null;
  return findAttemptById(row.id);
}
