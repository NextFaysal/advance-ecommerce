// TEMPORARY DEMO data for /admin/payments — Agent 42.
// Every record below is shaped EXACTLY like the real contracts so the
// page does not invent a parallel model:
//  - transactions: SandboxPaymentAttempt (src/integrations/sandbox/store.ts),
//    i.e. what GET /api/v1/admin/payments/sandbox returns;
//  - manual TrxID submissions: ManualTrxSubmission (src/integrations/payment.ts),
//    i.e. what GET /api/v1/admin/payments/manual-trx returns;
//  - COD settlement: CodSettlementRow (src/integrations/courier.ts),
//    i.e. the rows of GET /api/v1/admin/payments/cod-settlement.
// Nothing here is a real payment. When the DB wiring lands, the page
// swaps these constants for those API responses without shape changes.
// All amounts are integer poisha. Phones are full here only because the
// page renders them through the masking <Phone> component — never raw.
import type { CodSettlementRow, CourierProviderName } from "@/integrations/courier";
import type { ManualTrxSubmission } from "@/integrations/payment";
import { normalizeTrxId, type SandboxPaymentAttempt } from "@/integrations/sandbox/store";

/** Fixed demo "today" (Asia/Dhaka), matching the other admin demo pages. */
export const DEMO_TODAY_YMD = "2026-10-24";

/** yyyy-mm-dd of an ISO timestamp in the Asia/Dhaka business timezone. */
export function dhakaYmd(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** hh:mm, Asia/Dhaka — for table display. */
export function dhakaTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

const METHOD_LABELS_BN: Record<string, string> = {
  cod: "ক্যাশ অন ডেলিভারি (COD)",
  bkash: "বিকাশ (bKash)",
  nagad: "নগদ (Nagad)",
  rocket: "রকেট (Rocket)",
  upay: "উপায় (Upay)",
  sslcommerz: "SSLCommerz",
  aamarpay: "আমারপে (AamarPay)",
  shurjopay: "সূর্যপে (ShurjoPay)",
  stripe: "Stripe",
  paypal: "PayPal",
  manual_mobile_banking: "ম্যানুয়াল মোবাইল ব্যাংকিং",
};

export function paymentMethodLabelBn(method: string): string {
  return METHOD_LABELS_BN[method] ?? method;
}

export const COURIER_LABELS_BN: Record<CourierProviderName, string> = {
  steadfast: "স্টেডফাস্ট (Steadfast)",
  pathao: "পাঠাও (Pathao)",
  redx: "রেডএক্স (RedX)",
  paperfly: "পেপারফ্লাই (Paperfly)",
  ecourier: "ই-কুরিয়ার (eCourier)",
};

// ---------------------------------------------------------------------------
// Transactions — SandboxPaymentAttempt shape.
// ---------------------------------------------------------------------------

export const demoTransactions: SandboxPaymentAttempt[] = [
  {
    attemptId: "sbx-pay-demo-001",
    method: "bkash",
    orderId: "100245",
    amountPoisha: 125000,
    paidPoisha: 125000,
    refundedPoisha: 0,
    gatewayTransactionId: "SBX-BK-9HX7K2P4",
    idempotencyKey: "demo-idem-001",
    status: "PAID",
    createdAt: "2026-10-24T09:12:00+06:00",
  },
  {
    attemptId: "sbx-pay-demo-002",
    method: "cod",
    orderId: "100246",
    amountPoisha: 86000,
    paidPoisha: 0,
    refundedPoisha: 0,
    gatewayTransactionId: "",
    idempotencyKey: "demo-idem-002",
    status: "UNPAID",
    createdAt: "2026-10-24T09:40:00+06:00",
  },
  {
    attemptId: "sbx-pay-demo-003",
    method: "nagad",
    orderId: "100247",
    amountPoisha: 200000,
    paidPoisha: 100000,
    refundedPoisha: 0,
    gatewayTransactionId: "SBX-NG-51TQ8Z0A",
    idempotencyKey: "demo-idem-003",
    status: "PARTIAL",
    createdAt: "2026-10-24T10:05:00+06:00",
  },
  {
    attemptId: "sbx-pay-demo-004",
    method: "sslcommerz",
    orderId: "100248",
    amountPoisha: 349900,
    paidPoisha: 349900,
    refundedPoisha: 0,
    gatewayTransactionId: "SBX-SSL-VAL-7781",
    idempotencyKey: "demo-idem-004",
    status: "PAID",
    createdAt: "2026-10-24T10:31:00+06:00",
  },
  {
    attemptId: "sbx-pay-demo-005",
    method: "bkash",
    orderId: "100249",
    amountPoisha: 54000,
    paidPoisha: 0,
    refundedPoisha: 0,
    gatewayTransactionId: "SBX-BK-FAILED-02",
    idempotencyKey: "demo-idem-005",
    status: "FAILED",
    createdAt: "2026-10-24T11:02:00+06:00",
  },
  {
    attemptId: "sbx-pay-demo-006",
    method: "sslcommerz",
    orderId: "100243",
    amountPoisha: 150000,
    paidPoisha: 150000,
    refundedPoisha: 50000,
    gatewayTransactionId: "SBX-SSL-VAL-7740",
    idempotencyKey: "demo-idem-006",
    status: "PARTIALLY_REFUNDED",
    createdAt: "2026-10-24T11:20:00+06:00",
  },
  {
    attemptId: "sbx-pay-demo-007",
    method: "manual_mobile_banking",
    orderId: "100240",
    amountPoisha: 45000,
    paidPoisha: 45000,
    refundedPoisha: 0,
    gatewayTransactionId: "BK77MN09",
    idempotencyKey: "demo-idem-007",
    status: "PAID",
    createdAt: "2026-10-24T08:47:00+06:00",
  },
  {
    attemptId: "sbx-pay-demo-008",
    method: "bkash",
    orderId: "100238",
    amountPoisha: 75000,
    paidPoisha: 75000,
    refundedPoisha: 75000,
    gatewayTransactionId: "SBX-BK-RET-3310",
    idempotencyKey: "demo-idem-008",
    status: "REFUNDED",
    createdAt: "2026-10-23T16:15:00+06:00",
  },
];

export interface TransactionSummary {
  /** Sum of paidPoisha for today's attempts that actually received money. */
  collectedTodayPoisha: number;
  /** Sum of refundedPoisha for today's attempts. */
  refundedTodayPoisha: number;
}

export function summarizeTransactions(
  attempts: SandboxPaymentAttempt[],
  todayYmd: string,
): TransactionSummary {
  let collectedTodayPoisha = 0;
  let refundedTodayPoisha = 0;
  for (const a of attempts) {
    if (dhakaYmd(a.createdAt) !== todayYmd) continue;
    collectedTodayPoisha += a.paidPoisha;
    refundedTodayPoisha += a.refundedPoisha;
  }
  return { collectedTodayPoisha, refundedTodayPoisha };
}

// ---------------------------------------------------------------------------
// Manual TrxID submissions — ManualTrxSubmission shape.
// Demo duplicates, on purpose:
//  - demo-trx-001 and demo-trx-002 are the same bKash TrxID (different
//    case in the raw claim — normalisation makes them equal), both pending;
//  - demo-trx-005 re-claims the TrxID that demo-trx-004 already had
//    APPROVED. Per sandbox rule 1 (manual-trx.ts) it can never be approved.
// ---------------------------------------------------------------------------

export const demoManualSubmissions: ManualTrxSubmission[] = [
  {
    id: "sbx-trx-demo-001",
    orderId: "100251",
    method: "bkash",
    trxId: "9HX7K2P4QD",
    senderPhone: "+8801712345678",
    amountPoisha: 45000,
    status: "pending",
    reviewedById: null,
    reviewNote: null,
    submittedAt: "2026-10-24T10:05:00+06:00",
  },
  {
    id: "sbx-trx-demo-002",
    orderId: "100252",
    method: "bkash",
    trxId: "9hx7k2p4qd",
    senderPhone: "+8801812345678",
    amountPoisha: 45000,
    status: "pending",
    reviewedById: null,
    reviewNote: null,
    submittedAt: "2026-10-24T10:19:00+06:00",
  },
  {
    id: "sbx-trx-demo-003",
    orderId: "100253",
    method: "nagad",
    trxId: "NGD88XZ21K",
    senderPhone: "+8801912345678",
    amountPoisha: 120000,
    status: "pending",
    reviewedById: null,
    reviewNote: null,
    submittedAt: "2026-10-24T10:44:00+06:00",
  },
  {
    id: "sbx-trx-demo-004",
    orderId: "100240",
    method: "bkash",
    trxId: "BK77MN09",
    senderPhone: "+8801612345678",
    amountPoisha: 45000,
    status: "approved",
    reviewedById: "demo-admin",
    reviewNote: "SMS যাচাইয়ে মিলেছে (ডেমো)",
    submittedAt: "2026-10-24T08:30:00+06:00",
  },
  {
    id: "sbx-trx-demo-005",
    orderId: "100254",
    method: "bkash",
    trxId: "BK77MN09",
    senderPhone: "+8801512345678",
    amountPoisha: 45000,
    status: "pending",
    reviewedById: null,
    reviewNote: null,
    submittedAt: "2026-10-24T11:01:00+06:00",
  },
  {
    id: "sbx-trx-demo-006",
    orderId: "100236",
    method: "rocket",
    trxId: "RKT55PLM77",
    senderPhone: "+8801312345678",
    amountPoisha: 98000,
    status: "rejected",
    reviewedById: "demo-admin",
    reviewNote: "পরিমাণ মেলেনি (ডেমো)",
    submittedAt: "2026-10-23T15:12:00+06:00",
  },
];

/**
 * Duplicate groups under the sandbox manual-trx rule: the same
 * (method, normalised TrxID) — the exact comparison checkDuplicateTrx /
 * findManualTrxByMethodAndTrx perform in the sandbox store. Returns a
 * map from submission id to the ids it collides with (excluding itself).
 */
export function findDuplicateTrxCollisions(
  submissions: ManualTrxSubmission[],
): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const s of submissions) {
    const key = `${s.method}:${normalizeTrxId(s.trxId)}`;
    const ids = byKey.get(key) ?? [];
    ids.push(s.id);
    byKey.set(key, ids);
  }
  const collisions = new Map<string, string[]>();
  for (const s of submissions) {
    const ids = byKey.get(`${s.method}:${normalizeTrxId(s.trxId)}`) ?? [];
    if (ids.length > 1) collisions.set(s.id, ids.filter((id) => id !== s.id));
  }
  return collisions;
}

// ---------------------------------------------------------------------------
// COD settlement — CodSettlementRow shape (status: pending/settled/disputed).
// Disputed rows are reported separately and are NEVER netted into the
// outstanding or settled totals (sandbox cod-settlement.ts rule: a row
// that disagrees with the courier invoice is disputed, never adjusted).
// ---------------------------------------------------------------------------

export const demoCodSettlementRows: CodSettlementRow[] = [
  {
    shipmentId: "sbx-shp-demo-101",
    orderId: "100231",
    provider: "steadfast",
    collectedPoisha: 86000,
    courierChargePoisha: 6000,
    payablePoisha: 80000,
    status: "pending",
  },
  {
    shipmentId: "sbx-shp-demo-102",
    orderId: "100228",
    provider: "steadfast",
    collectedPoisha: 132000,
    courierChargePoisha: 6000,
    payablePoisha: 126000,
    status: "settled",
  },
  {
    shipmentId: "sbx-shp-demo-103",
    orderId: "100233",
    provider: "pathao",
    collectedPoisha: 97500,
    courierChargePoisha: 10000,
    payablePoisha: 87500,
    status: "pending",
  },
  {
    shipmentId: "sbx-shp-demo-104",
    orderId: "100229",
    provider: "pathao",
    collectedPoisha: 64000,
    courierChargePoisha: 10000,
    payablePoisha: 54000,
    status: "disputed",
  },
  {
    shipmentId: "sbx-shp-demo-105",
    orderId: "100235",
    provider: "redx",
    collectedPoisha: 210000,
    courierChargePoisha: 12000,
    payablePoisha: 198000,
    status: "settled",
  },
  {
    shipmentId: "sbx-shp-demo-106",
    orderId: "100237",
    provider: "redx",
    collectedPoisha: 45500,
    courierChargePoisha: 10000,
    payablePoisha: 35500,
    status: "pending",
  },
];

export interface CodProviderSummary {
  provider: CourierProviderName;
  shipmentCount: number;
  collectedPoisha: number;
  courierChargePoisha: number;
  /** Payable on rows still pending — money the courier still owes. */
  outstandingPoisha: number;
  /** Payable on settled rows. */
  settledPoisha: number;
  /** Payable on disputed rows — flagged only, excluded from both totals above. */
  disputedPoisha: number;
}

export function summarizeCodByProvider(rows: CodSettlementRow[]): CodProviderSummary[] {
  const byProvider = new Map<CourierProviderName, CodProviderSummary>();
  for (const row of rows) {
    const s = byProvider.get(row.provider) ?? {
      provider: row.provider,
      shipmentCount: 0,
      collectedPoisha: 0,
      courierChargePoisha: 0,
      outstandingPoisha: 0,
      settledPoisha: 0,
      disputedPoisha: 0,
    };
    s.shipmentCount += 1;
    s.collectedPoisha += row.collectedPoisha;
    s.courierChargePoisha += row.courierChargePoisha;
    if (row.status === "pending") s.outstandingPoisha += row.payablePoisha;
    else if (row.status === "settled") s.settledPoisha += row.payablePoisha;
    else s.disputedPoisha += row.payablePoisha;
    byProvider.set(row.provider, s);
  }
  return [...byProvider.values()];
}

export function totalCodOutstandingPoisha(rows: CodSettlementRow[]): number {
  return rows
    .filter((r) => r.status === "pending")
    .reduce((sum, r) => sum + r.payablePoisha, 0);
}
