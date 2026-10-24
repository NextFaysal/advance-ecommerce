// Sandbox store — process-local, SIMULATED data only. Agent 9.
// This in-memory store lets the sandbox adapters, webhooks and manual TrxID
// flow be exercised end-to-end WITHOUT a database and WITHOUT any real
// provider. It is NOT a production store:
//  - it resets when the server process restarts,
//  - it is not shared between instances,
//  - it must be replaced by the DB tables in ../SCHEMA-ADDITIONS.md
//    (payments, payment_attempts, manual_trx_submissions with a UNIQUE
//    index on (method, trxId), shipments, shipment_events, webhook_logs)
//    before any real provider integration. Never store a real credential,
//    a real customer payment, or a real order payment in this store.
import type { ManualTrxSubmission, PaymentStatus } from "../payment";
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
  /** Minimal order status tracked only to demonstrate state-machine mapping. */
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

export interface SandboxStore {
  payments: Map<string, SandboxPaymentAttempt>;
  shipments: Map<string, SandboxShipment>;
  manualTrx: Map<string, ManualTrxSubmission>;
  /** idempotencyKey -> first result, per channel. A replay returns this. */
  webhookResults: Map<string, { applied: boolean; duplicate: boolean }>;
  webhookLog: WebhookLogEntry[];
}

export const sandboxStore: SandboxStore = {
  payments: new Map(),
  shipments: new Map(),
  manualTrx: new Map(),
  webhookResults: new Map(),
  webhookLog: [],
};

export function logWebhook(entry: Omit<WebhookLogEntry, "id" | "receivedAt">): WebhookLogEntry {
  const full: WebhookLogEntry = {
    ...entry,
    id: `sbx-wh-${sandboxStore.webhookLog.length + 1}`,
    receivedAt: new Date().toISOString(),
  };
  sandboxStore.webhookLog.push(full);
  return full;
}

/** Normalise a TrxID for duplicate comparison: trim + uppercase. */
export function normalizeTrxId(trxId: string): string {
  return trxId.trim().toUpperCase();
}

export function findManualTrxByMethodAndTrx(
  method: ManualTrxSubmission["method"],
  trxId: string,
): ManualTrxSubmission | null {
  const normalized = normalizeTrxId(trxId);
  for (const sub of sandboxStore.manualTrx.values()) {
    if (sub.method === method && normalizeTrxId(sub.trxId) === normalized) return sub;
  }
  return null;
}

/** Test/support only: clear all simulated data. Never call from a route. */
export function resetSandboxStore(): void {
  sandboxStore.payments.clear();
  sandboxStore.shipments.clear();
  sandboxStore.manualTrx.clear();
  sandboxStore.webhookResults.clear();
  sandboxStore.webhookLog = [];
}
