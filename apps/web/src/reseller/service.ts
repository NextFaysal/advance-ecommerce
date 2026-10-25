/**
 * Reseller service — dashboard builder + DEMO fixture data. Agent 14.
 *
 * PERSISTENCE SWAP DONE: the production path is src/reseller/store.ts
 * (Prisma tables Reseller / ResellerPriceEntry / ResellerWalletEntry /
 * ResellerWithdrawal); all API routes and the admin page read/write
 * through it. buildDashboard below stays — it is the pure dashboard
 * builder the DB store reuses. The DEMO_* arrays in this file remain
 * only as labelled fixtures and are no longer read by any route/page.
 *
 * Phone handling: the full normalized phone is stored on the demo Reseller
 * record (server-side only shape). Every outward shape (dashboard, API
 * responses) carries phoneMasked via maskPhone() — the full number is never
 * returned by this module's public builders.
 */
import { maskPhone } from "../checkout/validation";
import { nextTierProgress, tierForLifetimeSales } from "./pricing";
import {
  TIER_COMMISSION_BPS,
  type Reseller,
  type ResellerDashboard,
  type ResellerPriceEntry,
  type WalletEntry,
  type WithdrawalRequest,
} from "./types";
import { pendingWithdrawalTotal, walletBalance } from "./wallet";

/** DEMO ONLY — sample resellers so the panel renders before DB wiring. */
export const DEMO_RESELLERS: Reseller[] = [
  {
    id: "res-1",
    name: "Rahim Enterprise",
    phone: "+8801712345678",
    status: "ACTIVE",
    tier: "SILVER",
    lifetimeSalesPoisha: 12_500_000,
    createdAt: "2026-09-01T09:00:00.000Z",
  },
  {
    id: "res-2",
    name: "Fatema Fashion House",
    phone: "+8801812349876",
    status: "ACTIVE",
    tier: "BRONZE",
    lifetimeSalesPoisha: 850_000,
    createdAt: "2026-10-02T09:00:00.000Z",
  },
];

export const DEMO_PRICE_ENTRIES: ResellerPriceEntry[] = [
  {
    variantId: "var-jamdani-red",
    sku: "SHAREE-JAMDANI-RED",
    productName: "Jamdani Sharee — Red",
    basePricePoisha: 380_000,
    resellerPricePoisha: 450_000,
  },
  {
    variantId: "var-panjabi-m",
    sku: "PANJABI-COTTON-M",
    productName: "Cotton Panjabi — M",
    basePricePoisha: 95_000,
    resellerPricePoisha: 120_000,
  },
];

export const demoWalletEntries: WalletEntry[] = [
  {
    id: "wlt-demo-1",
    resellerId: "res-1",
    type: "COMMISSION_CREDIT",
    amountPoisha: 62_500,
    balanceAfterPoisha: 62_500,
    orderId: "ord-demo-101",
    createdAt: "2026-10-10T10:00:00.000Z",
  },
  {
    id: "wlt-demo-2",
    resellerId: "res-1",
    type: "MARGIN_CREDIT",
    amountPoisha: 70_000,
    balanceAfterPoisha: 132_500,
    orderId: "ord-demo-101",
    createdAt: "2026-10-10T10:00:00.000Z",
  },
];

export const demoWithdrawals: WithdrawalRequest[] = [];

/** Current demo-store reseller record, including the status wallet guards enforce. */
export function findDemoReseller(resellerId: string): Reseller | null {
  return DEMO_RESELLERS.find((reseller) => reseller.id === resellerId) ?? null;
}

/** Build the dashboard shape for one reseller. Tier is re-derived from sales. */
export function buildDashboard(
  reseller: Reseller,
  entries: readonly WalletEntry[],
  withdrawals: readonly WithdrawalRequest[],
  priceEntries: readonly ResellerPriceEntry[],
): ResellerDashboard {
  const mine = entries.filter((e) => e.resellerId === reseller.id);
  const myWithdrawals = withdrawals.filter((w) => w.resellerId === reseller.id);
  const tier = tierForLifetimeSales(reseller.lifetimeSalesPoisha);
  const progress = nextTierProgress(reseller.lifetimeSalesPoisha);
  return {
    resellerId: reseller.id,
    name: reseller.name,
    phoneMasked: maskPhone(reseller.phone),
    ...(reseller.code ? { code: reseller.code } : {}),
    tier,
    nextTier: progress.nextTier,
    toNextTierPoisha: progress.toNextTierPoisha,
    commissionBps: TIER_COMMISSION_BPS[tier],
    lifetimeSalesPoisha: reseller.lifetimeSalesPoisha,
    walletBalancePoisha: walletBalance(mine),
    pendingWithdrawalPoisha: pendingWithdrawalTotal(myWithdrawals),
    priceEntryCount: priceEntries.length,
  };
}

export function demoDashboards(): ResellerDashboard[] {
  return DEMO_RESELLERS.map((r) =>
    buildDashboard(r, demoWalletEntries, demoWithdrawals, DEMO_PRICE_ENTRIES),
  );
}
