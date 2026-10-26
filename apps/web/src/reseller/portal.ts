/**
 * Reseller portal dashboard — ADV-12 read model.
 *
 * Everything here is the reseller's OWN data. Customer info on
 * attributed orders is minimal: name as recorded + MASKED phone —
 * a full customer phone never leaves through the portal.
 * Commission per order is read from the wallet ledger (entries whose
 * refId is the order id); an order with no credit entries is labelled
 * AWAITING_DELIVERY / NOT_CREDITED truthfully rather than shown a
 * fabricated amount.
 */
import { prisma } from "@advance-ecommerce/db";
import { maskPhone } from "../checkout/validation";
import { getPayoutBalancesDb, listPayoutRequests } from "./payout-store";
import type { PayoutBalances, PayoutRequest } from "./payouts";
import { getReseller, getResellerTierState, listPriceEntries, listWalletEntries } from "./store";
import { loadTierConfig } from "./tier-config";
import { nextTierProgressForCommission } from "./tiers";
import type { ResellerPriceEntry, ResellerTier, WalletEntry } from "./types";

export interface PortalAttributedOrder {
  orderId: string;
  orderNo: string;
  status: string;
  totalPoisha: number;
  customerName: string;
  customerPhoneMasked: string;
  createdAt: string;
  /** Commission + margin credited for this order (from the ledger). */
  creditedPoisha: number;
  commissionStatus: "CREDITED" | "AWAITING_DELIVERY" | "NOT_CREDITED";
}

export interface ResellerPortalDashboard {
  resellerId: string;
  name: string;
  phoneMasked: string;
  status: string;
  code: string | null;
  referralLink: string | null;
  tier: ResellerTier;
  commissionBps: number;
  nextTier: ResellerTier | null;
  toNextTierPoisha: number;
  lifetimeCommissionPoisha: number;
  lifetimeMarginPoisha: number;
  /** Commission credited in the current Asia/Dhaka calendar month. */
  monthlyCommissionPoisha: number;
  lifetimeSalesPoisha: number;
  balances: PayoutBalances;
  orders: PortalAttributedOrder[];
  ledger: WalletEntry[];
  payoutRequests: PayoutRequest[];
  priceEntries: ResellerPriceEntry[];
}

/** Start (UTC instant) of the current Asia/Dhaka calendar month. Dhaka is UTC+6, no DST. */
export function dhakaMonthStartUtc(now: Date = new Date()): Date {
  const dhaka = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  return new Date(Date.UTC(dhaka.getUTCFullYear(), dhaka.getUTCMonth(), 1) - 6 * 60 * 60 * 1000);
}

export async function buildPortalDashboard(resellerId: string): Promise<ResellerPortalDashboard | null> {
  const reseller = await getReseller(resellerId);
  if (!reseller) return null;
  const config = await loadTierConfig();
  const [tierState, entries, balances, payoutRequests, priceEntries, orderRows] = await Promise.all([
    getResellerTierState(resellerId, config),
    listWalletEntries(resellerId),
    getPayoutBalancesDb(resellerId),
    listPayoutRequests(resellerId),
    listPriceEntries(resellerId),
    prisma.order.findMany({
      where: { resellerId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        orderNo: true,
        status: true,
        totalPoisha: true,
        customerName: true,
        customerPhone: true,
        createdAt: true,
      },
    }),
  ]);
  if (!tierState) return null;

  // Per-order credited totals from the ledger (credit entries carry
  // refId = orderId — the same convention lifetime sales derive from).
  const creditedByOrder = new Map<string, number>();
  let lifetimeMarginPoisha = 0;
  let monthlyCommissionPoisha = 0;
  const monthStart = dhakaMonthStartUtc();
  for (const e of entries) {
    if (e.type === "COMMISSION_CREDIT" || e.type === "MARGIN_CREDIT") {
      if (e.orderId) creditedByOrder.set(e.orderId, (creditedByOrder.get(e.orderId) ?? 0) + e.amountPoisha);
    }
    if (e.type === "MARGIN_CREDIT") lifetimeMarginPoisha += e.amountPoisha;
    if (e.type === "COMMISSION_CREDIT" && new Date(e.createdAt) >= monthStart) {
      monthlyCommissionPoisha += e.amountPoisha;
    }
  }

  const orders: PortalAttributedOrder[] = orderRows.map((o) => {
    const credited = creditedByOrder.get(o.id) ?? 0;
    return {
      orderId: o.id,
      orderNo: o.orderNo,
      status: o.status,
      totalPoisha: o.totalPoisha,
      customerName: o.customerName,
      customerPhoneMasked: maskPhone(o.customerPhone),
      createdAt: o.createdAt.toISOString(),
      creditedPoisha: credited,
      commissionStatus:
        credited > 0 ? "CREDITED" : o.status === "DELIVERED" ? "NOT_CREDITED" : "AWAITING_DELIVERY",
    };
  });

  const progress = nextTierProgressForCommission(tierState.lifetimeCommissionPoisha, config);
  const appBaseUrl = process.env["NEXT_PUBLIC_APP_URL"] ?? "";
  return {
    resellerId: reseller.id,
    name: reseller.name,
    phoneMasked: maskPhone(reseller.phone),
    status: reseller.status,
    code: reseller.code ?? null,
    referralLink: reseller.code ? `${appBaseUrl}/?ref=${reseller.code}` : null,
    tier: tierState.tier,
    commissionBps: tierState.rateBps,
    nextTier: progress.nextTier,
    toNextTierPoisha: progress.toNextTierPoisha,
    lifetimeCommissionPoisha: tierState.lifetimeCommissionPoisha,
    lifetimeMarginPoisha,
    monthlyCommissionPoisha,
    lifetimeSalesPoisha: reseller.lifetimeSalesPoisha,
    balances,
    orders,
    ledger: [...entries].reverse().slice(0, 50),
    payoutRequests,
    priceEntries,
  };
}
