/**
 * Affiliate — pure logic (Agent 36).
 *
 * Commission is basis points of the attributed order total, in integer
 * poisha. FRAUD GUARD: a commission is only a PENDING record when the
 * order is delivered; it becomes PAYABLE only after the return window
 * (config.affiliateReturnWindowDays) has passed with the order still
 * DELIVERED, and VOID if the order is returned/refunded. Attribution is
 * the 30-day cookie-window shape in types.ts (AffiliateAttribution).
 */
import {
  DEFAULT_LOYALTY_CONFIG,
  type AffiliateCommissionEntry,
  type AffiliateCommissionStatus,
  type LoyaltyConfig,
} from "./types";

/** Commission in poisha: floor(total * bps / 10000). */
export function computeAffiliateCommission(orderTotalPoisha: number, commissionBps: number): number {
  if (orderTotalPoisha <= 0 || commissionBps <= 0) return 0;
  return Math.floor((orderTotalPoisha * commissionBps) / 10_000);
}

/** Is an attribution touch still inside its cookie window at `nowIso`? */
export function isAttributionValid(expiresAt: string, nowIso: string): boolean {
  return new Date(expiresAt).getTime() > new Date(nowIso).getTime();
}

/**
 * Status of a commission given the order's current state. Pure: callers
 * re-evaluate on order status changes and on the payout run.
 */
export function affiliateCommissionStatus(input: {
  orderStatus: string;
  deliveredAt: string | null;
  nowIso: string;
  config?: LoyaltyConfig;
}): AffiliateCommissionStatus {
  const config = input.config ?? DEFAULT_LOYALTY_CONFIG;
  if (input.orderStatus === "RETURNED" || input.orderStatus === "REFUNDED" || input.orderStatus === "CANCELLED") {
    return "VOID";
  }
  if (input.orderStatus !== "DELIVERED" || !input.deliveredAt) return "PENDING";
  const payableAt = new Date(input.deliveredAt).getTime() + config.affiliateReturnWindowDays * 86_400_000;
  return new Date(input.nowIso).getTime() >= payableAt ? "PAYABLE" : "PENDING";
}

export function buildCommissionEntry(input: {
  id: string;
  partnerId: string;
  orderId: string;
  orderTotalPoisha: number;
  commissionBps: number;
  orderStatus: string;
  deliveredAt: string;
  nowIso: string;
  config?: LoyaltyConfig;
}): AffiliateCommissionEntry {
  return {
    id: input.id,
    partnerId: input.partnerId,
    orderId: input.orderId,
    orderTotalPoisha: input.orderTotalPoisha,
    commissionBps: input.commissionBps,
    commissionPoisha: computeAffiliateCommission(input.orderTotalPoisha, input.commissionBps),
    status: affiliateCommissionStatus({
      orderStatus: input.orderStatus,
      deliveredAt: input.deliveredAt,
      nowIso: input.nowIso,
      config: input.config,
    }),
    deliveredAt: input.deliveredAt,
    createdAt: input.nowIso,
  };
}

export interface AffiliatePayoutSummary {
  partnerId: string;
  pendingPoisha: number;
  payablePoisha: number;
  paidPoisha: number;
  voidPoisha: number;
  entryCount: number;
}

/** Payout summary for one partner from their commission entries. */
export function summarizeAffiliatePayout(entries: readonly AffiliateCommissionEntry[], partnerId: string): AffiliatePayoutSummary {
  const mine = entries.filter((e) => e.partnerId === partnerId);
  const sum = (status: AffiliateCommissionStatus) =>
    mine.filter((e) => e.status === status).reduce((s, e) => s + e.commissionPoisha, 0);
  return {
    partnerId,
    pendingPoisha: sum("PENDING"),
    payablePoisha: sum("PAYABLE"),
    paidPoisha: sum("PAID"),
    voidPoisha: sum("VOID"),
    entryCount: mine.length,
  };
}
