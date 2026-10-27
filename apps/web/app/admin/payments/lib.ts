// Pure helpers for /admin/payments — labels, Dhaka-time formatting and
// summary computations over the REAL API shapes (SandboxPaymentAttempt,
// ManualTrxSubmission, CodSettlementRow). No data lives here: the page
// loads records from the DB-backed stores in src/integrations/sandbox.
import type { CodSettlementRow, CourierProviderName } from "@/integrations/courier";
import type { Locale } from "@/i18n/locale";
import type { ManualTrxSubmission } from "@/integrations/payment";
import { normalizeTrxId, type SandboxPaymentAttempt } from "@/integrations/sandbox/store";

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

const METHOD_LABELS: Record<Locale, Record<string, string>> = {
  bn: {
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
  },
  en: {
    cod: "Cash on Delivery (COD)",
    bkash: "bKash",
    nagad: "Nagad",
    rocket: "Rocket",
    upay: "Upay",
    sslcommerz: "SSLCommerz",
    aamarpay: "AamarPay",
    shurjopay: "ShurjoPay",
    stripe: "Stripe",
    paypal: "PayPal",
    manual_mobile_banking: "Manual mobile banking",
  },
};

export function paymentMethodLabel(locale: Locale, method: string): string {
  return METHOD_LABELS[locale][method] ?? method;
}

export const COURIER_LABELS: Record<Locale, Record<CourierProviderName, string>> = {
  bn: {
    steadfast: "স্টেডফাস্ট (Steadfast)",
    pathao: "পাঠাও (Pathao)",
    redx: "রেডএক্স (RedX)",
    paperfly: "পেপারফ্লাই (Paperfly)",
    ecourier: "ই-কুরিয়ার (eCourier)",
  },
  en: {
    steadfast: "Steadfast",
    pathao: "Pathao",
    redx: "RedX",
    paperfly: "Paperfly",
    ecourier: "eCourier",
  },
};

// ---------------------------------------------------------------------------
// Transactions — SandboxPaymentAttempt shape.
// ---------------------------------------------------------------------------

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
// Manual TrxID duplicates — the same (method, normalised TrxID) comparison
// checkDuplicateTrx / findManualTrxByMethodAndTrx perform in the sandbox
// store. Returns a map from submission id to the ids it collides with.
// ---------------------------------------------------------------------------

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
