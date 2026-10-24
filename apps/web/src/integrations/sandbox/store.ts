// Sandbox integration shapes + webhook memory — Agent 9; DB swap 2026-10-24.
// The process-local Maps that used to persist sandbox payments,
// shipments and manual TrxID submissions are GONE: those records now
// live in the real tables via ./db-store.ts (Payment / PaymentAttempt /
// Refund / ManualTrxSubmission / Shipment / ShipmentEvent). This module
// keeps only:
//  - the shared TS shapes (SandboxPaymentAttempt, SandboxShipment,
//    WebhookLogEntry) that routes, pages and the BD modules consume;
//  - normalizeTrxId (pure);
//  - the webhook attempt log + idempotency RESULTS, which stay
//    process-local for one documented reason: the merged Prisma schema
//    has NO webhook_logs table (schema drift, reported — not silently
//    worked around). Courier webhook applies additionally persist a
//    ShipmentEvent whose idempotencyKey is UNIQUE, so a replayed courier
//    webhook is backstopped by the DB even across restarts; payment
//    webhook state application is itself idempotent (it writes the
//    mapped status onto the persisted attempt).
import type { PaymentStatus } from "../payment";
import type { ShipmentStatus } from "../courier";
import type { OrderStatus } from "../../orders/types";

export interface SandboxPaymentAttempt {
  attemptId: string;
  method: string;
  orderId: string;
  amountPoisha: number;
  paidPoisha: number;
  refundedPoisha: number;
  gatewayTransactionId: string;
  idempotencyKey: string;
  status: PaymentStatus;
  createdAt: string;
}

export interface SandboxShipment {
  shipmentId: string;
  trackingId: string;
  provider: string;
  orderId: string;
  codAmountPoisha: number;
  weightGrams: number;
  status: ShipmentStatus;
  statusHistory: ShipmentStatus[];
  /** Linked order's CURRENT status, read from the Order row (read-only). */
  orderStatus: OrderStatus;
  idempotencyKey: string;
  createdAt: string;
}

export interface WebhookLogEntry {
  id: string;
  channel: "payment" | "courier";
  provider: string;
  idempotencyKey: string;
  verified: boolean;
  applied: boolean;
  duplicate: boolean;
  /** Short reason only — never the signature, secret, or full raw body. */
  reason: string | null;
  receivedAt: string;
}

/**
 * Process-local webhook bookkeeping (see module header for why this is
 * not in the DB). `results` maps `${channel}:${provider}:${key}` to the
 * first result so a replay inside this process returns duplicate:true.
 */
export const webhookMemory: {
  results: Map<string, { applied: boolean; duplicate: boolean }>;
  log: WebhookLogEntry[];
} = {
  results: new Map(),
  log: [],
};

export function logWebhook(entry: Omit<WebhookLogEntry, "id" | "receivedAt">): WebhookLogEntry {
  const full: WebhookLogEntry = {
    ...entry,
    id: `sbx-wh-${webhookMemory.log.length + 1}`,
    receivedAt: new Date().toISOString(),
  };
  webhookMemory.log.push(full);
  return full;
}

/** Normalise a TrxID for duplicate comparison: trim + uppercase. */
export function normalizeTrxId(trxId: string): string {
  return trxId.trim().toUpperCase();
}

/** Test/support only: clear the process-local webhook memory. */
export function resetWebhookMemory(): void {
  webhookMemory.results.clear();
  webhookMemory.log = [];
}
