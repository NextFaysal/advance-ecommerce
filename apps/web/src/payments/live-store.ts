/**
 * Live payment persistence seam — ADV-4 (doc 22).
 *
 * The live gateway adapters (src/integrations/sslcommerz.ts,
 * src/integrations/nagad.ts) confirm money through the SAME path the
 * sandbox flow uses — there is exactly one confirmation funnel in
 * this codebase and live money must flow through it too:
 *
 *   applyAttemptStatus()  (sandbox/db-store.ts — writes the
 *                          PaymentAttempt + Payment rows in one tx)
 *   recordRefund()        (sandbox/db-store.ts — Refund rows)
 *   markOrderPayment()    (orders/repository.ts — recomputes the
 *                          Order's payment status from persisted rows
 *                          and publishes payment.succeeded)
 *
 * This module is the injectable seam around that path. Adapters take
 * an optional LivePaymentStore (default: prismaLivePaymentStore) so
 * the whole adapter surface is smoke-testable with an in-memory fake
 * and a mocked fetch — no database, no network.
 *
 * It adds the two things the sandbox store does not carry:
 *  - gatewayResponseRef reads/writes (PaymentAttempt.gatewayResponseRef
 *    — where a live adapter parks the provider-side reference it needs
 *    later: Nagad's paymentReferenceId, SSLCommerz's bank_tran_id);
 *  - money helpers for the BDT-decimal boundary. Money inside the
 *    platform is ALWAYS integer poisha; a provider's decimal taka
 *    string is converted exactly once, here, by string parsing —
 *    never through a float multiply.
 */
import { createHash } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import type { PaymentStatus } from "../integrations/payment";
import {
  applyAttemptStatus,
  findAttemptById,
  getOrCreateAttempt,
  recordRefund,
} from "../integrations/sandbox/db-store";
import type { SandboxPaymentAttempt } from "../integrations/sandbox/store";
import { markOrderPayment, type OrderPaymentSource } from "../orders/repository";

/* ------------------------------------------------------------------ */
/* Money at the provider boundary (BDT decimal <-> integer poisha)     */
/* ------------------------------------------------------------------ */

/** 1910 poisha -> "19.10". Always exactly two decimal places. */
export function poishaToBdtDecimal(amountPoisha: number): string {
  if (!Number.isSafeInteger(amountPoisha) || amountPoisha < 0) {
    throw new Error(`poishaToBdtDecimal: not a non-negative integer poisha amount: ${amountPoisha}`);
  }
  const taka = Math.floor(amountPoisha / 100);
  const poisha = amountPoisha % 100;
  return `${taka}.${poisha.toString().padStart(2, "0")}`;
}

/**
 * "19.10" -> 1910, "19" -> 1900, "19.1" -> 1910. Returns null for
 * anything that is not an exact BDT decimal (more than 2dp, negative,
 * thousands separators, exponent notation, empty) — a provider amount
 * that cannot be represented exactly in poisha must never be rounded
 * into a match.
 */
export function bdtDecimalToPoisha(value: string | number): number | null {
  const text = typeof value === "number" ? String(value) : value.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const taka = Number(match[1]);
  const frac = match[2] === undefined ? 0 : Number(match[2].padEnd(2, "0"));
  const poisha = taka * 100 + frac;
  return Number.isSafeInteger(poisha) ? poisha : null;
}

/* ------------------------------------------------------------------ */
/* Attempt ids                                                         */
/* ------------------------------------------------------------------ */

/**
 * Deterministic live attempt id from (method, idempotencyKey), e.g.
 * LIVE-SSL-A1B2C3D4E5F6A7B8. The LIVE- prefix keeps live attempts
 * unmistakable next to the sandbox SBX- ids in the same tables; a
 * replayed initiation resolves to the same attempt row, exactly like
 * the sandbox deterministic ids. Short provider codes keep the id
 * within SSLCommerz's 30-char tran_id limit (25 chars worst case).
 */
const ATTEMPT_ID_SHORT_CODE: Record<string, string> = {
  sslcommerz: "SSL",
  nagad: "NAGAD",
  bkash: "BKASH",
};

export function liveAttemptId(method: string, idempotencyKey: string): string {
  const short = ATTEMPT_ID_SHORT_CODE[method] ?? method.toUpperCase().slice(0, 6);
  const hash = createHash("sha256")
    .update(`live:${method}:${idempotencyKey}`)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
  return `LIVE-${short}-${hash}`;
}

/** The refund reference (refe_id) for one refund operation — stable
 *  per (attempt, idempotencyKey) so a retried refund presents the
 *  same reference to the provider. */
export function liveRefundRef(attemptId: string, idempotencyKey: string): string {
  const hash = createHash("sha256")
    .update(`refund:${attemptId}:${idempotencyKey}`)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  return `RF-${hash}`;
}

/* ------------------------------------------------------------------ */
/* Store seam                                                          */
/* ------------------------------------------------------------------ */

export interface LiveAttemptRecord {
  attemptId: string;
  method: string;
  orderId: string;
  amountPoisha: number;
  paidPoisha: number;
  refundedPoisha: number;
  /** Provider-facing reference WE issued (SSLCommerz tran_id, Nagad
   *  merchant order id). Mirrors PaymentAttempt.gatewayTransactionId. */
  gatewayTransactionId: string;
  /** Provider-issued reference parked for later calls (Nagad
   *  paymentReferenceId, SSLCommerz bank_tran_id). Null until set. */
  gatewayResponseRef: string | null;
  status: PaymentStatus;
}

export interface LivePaymentStore {
  getOrCreateAttempt(input: {
    method: string;
    orderRef: string;
    amountPoisha: number;
    attemptId: string;
    gatewayTransactionId: string;
    idempotencyKey: string;
  }): Promise<LiveAttemptRecord>;
  findAttemptById(attemptId: string): Promise<LiveAttemptRecord | null>;
  /** Lookup by the parked provider reference (callback entry point
   *  for Nagad, whose callback carries only payment_ref_id). */
  findAttemptByResponseRef(method: string, ref: string): Promise<LiveAttemptRecord | null>;
  setGatewayResponseRef(attemptId: string, ref: string): Promise<void>;
  applyStatus(
    attemptId: string,
    status: PaymentStatus,
    paidPoisha?: number,
  ): Promise<LiveAttemptRecord | null>;
  recordRefund(input: {
    attemptId: string;
    amountPoisha: number;
    reason: string;
  }): Promise<{ status: PaymentStatus; refundedPoisha: number } | null>;
  /** The order-paid funnel — the ONLY way an adapter moves an order. */
  markOrderPayment(
    orderId: string,
    input: { paymentStatus: PaymentStatus; source: OrderPaymentSource; reference: string },
  ): Promise<void>;
}

function withResponseRef(
  attempt: SandboxPaymentAttempt,
  gatewayResponseRef: string | null,
): LiveAttemptRecord {
  return {
    attemptId: attempt.attemptId,
    method: attempt.method,
    orderId: attempt.orderId,
    amountPoisha: attempt.amountPoisha,
    paidPoisha: attempt.paidPoisha,
    refundedPoisha: attempt.refundedPoisha,
    gatewayTransactionId: attempt.gatewayTransactionId,
    gatewayResponseRef,
    status: attempt.status,
  };
}

async function loadResponseRef(attemptId: string): Promise<string | null> {
  const row = await prisma.paymentAttempt.findUnique({
    where: { id: attemptId },
    select: { gatewayResponseRef: true },
  });
  return row?.gatewayResponseRef ?? null;
}

async function loadLiveAttempt(attemptId: string): Promise<LiveAttemptRecord | null> {
  const attempt = await findAttemptById(attemptId);
  if (!attempt) return null;
  return withResponseRef(attempt, await loadResponseRef(attemptId));
}

/** The production store: sandbox db-store writes + markOrderPayment. */
export const prismaLivePaymentStore: LivePaymentStore = {
  async getOrCreateAttempt(input) {
    const attempt = await getOrCreateAttempt(input);
    return withResponseRef(attempt, await loadResponseRef(attempt.attemptId));
  },
  async findAttemptById(attemptId) {
    return loadLiveAttempt(attemptId);
  },
  async findAttemptByResponseRef(method, ref) {
    const row = await prisma.paymentAttempt.findFirst({
      where: { gatewayResponseRef: ref },
      select: { id: true, method: true },
    });
    if (!row) return null;
    const attempt = await loadLiveAttempt(row.id);
    if (!attempt || attempt.method !== method) return null;
    return attempt;
  },
  async setGatewayResponseRef(attemptId, ref) {
    await prisma.paymentAttempt.update({
      where: { id: attemptId },
      data: { gatewayResponseRef: ref },
    });
  },
  async applyStatus(attemptId, status, paidPoisha) {
    const attempt = await applyAttemptStatus(attemptId, status, paidPoisha);
    if (!attempt) return null;
    return withResponseRef(attempt, await loadResponseRef(attemptId));
  },
  async recordRefund(input) {
    return recordRefund(input);
  },
  async markOrderPayment(orderId, input) {
    await markOrderPayment(orderId, input);
  },
};
