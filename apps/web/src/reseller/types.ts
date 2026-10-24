/**
 * Reseller domain types — Agent 14 (Step 46, A5).
 *
 * Money is ALWAYS integer poisha. No float anywhere in this module.
 * A reseller sells at their own price; the store keeps the base price.
 * Margin = resellerPrice - basePrice, and is NEVER negative (see pricing.ts):
 * a reseller price below the base price is rejected, not clamped silently.
 */
import { z } from "zod";

/** Tier by lifetime delivered sales (in poisha). Thresholds are inclusive. */
export type ResellerTier = "BRONZE" | "SILVER" | "GOLD";

/** Lifetime sales thresholds for tier upgrade, in poisha (BDT 0 / 1,00,000 / 5,00,000). */
export const TIER_THRESHOLDS_POISHA: Record<ResellerTier, number> = {
  BRONZE: 0,
  SILVER: 10_000_000, // ৳1,00,000
  GOLD: 50_000_000, // ৳5,00,000
};

/** Commission rate per tier, in basis points (100 bps = 1%). Integer only. */
export const TIER_COMMISSION_BPS: Record<ResellerTier, number> = {
  BRONZE: 500, // 5%
  SILVER: 750, // 7.5%
  GOLD: 1000, // 10%
};

export type ResellerStatus = "ACTIVE" | "SUSPENDED" | "PENDING_APPROVAL";

export interface Reseller {
  id: string;
  /** Public store identity shown in the reseller panel. */
  name: string;
  /** Normalized +8801XXXXXXXXX. Access/display rules live in service.ts: masked by default. */
  phone: string;
  email?: string;
  status: ResellerStatus;
  tier: ResellerTier;
  /** Lifetime DELIVERED sales total, poisha. Tier derives from this. */
  lifetimeSalesPoisha: number;
  createdAt: string;
}

/** One catalog entry as a reseller sees it: base price + their selling price. */
export interface ResellerPriceEntry {
  variantId: string;
  sku: string;
  productName: string;
  /** Store cost-to-reseller price, poisha. What the reseller pays the store. */
  basePricePoisha: number;
  /** What the reseller sells to the customer at, poisha. Must be >= basePricePoisha. */
  resellerPricePoisha: number;
}

export const resellerPriceInputSchema = z.object({
  variantId: z.string().min(1),
  /** Prices come in as integer poisha. A float is rejected by .int(). */
  basePricePoisha: z.number().int().nonnegative(),
  resellerPricePoisha: z.number().int().nonnegative(),
});

export type ResellerPriceInput = z.infer<typeof resellerPriceInputSchema>;

/** Wallet ledger — append-only, same discipline as stock_movements. */
export type WalletEntryType =
  | "COMMISSION_CREDIT" // order delivered -> commission earned
  | "MARGIN_CREDIT" // order delivered -> selling margin earned
  | "WITHDRAWAL_HOLD" // withdrawal requested -> funds held
  | "WITHDRAWAL_PAID" // withdrawal completed -> hold settled out
  | "WITHDRAWAL_RELEASE" // withdrawal rejected -> hold returned
  | "ADJUSTMENT"; // manual correction, reason required

export interface WalletEntry {
  id: string;
  resellerId: string;
  type: WalletEntryType;
  /** Signed delta to the available balance, poisha. Credits positive, holds negative. */
  amountPoisha: number;
  /** Balance after this entry, poisha. Never negative (enforced in wallet.ts). */
  balanceAfterPoisha: number;
  orderId?: string;
  withdrawalId?: string;
  note?: string;
  createdAt: string;
}

export type WithdrawalStatus = "PENDING" | "APPROVED" | "PAID" | "REJECTED";

export type WithdrawalMethod = "BKASH" | "NAGAD" | "BANK";

export interface WithdrawalRequest {
  id: string;
  resellerId: string;
  amountPoisha: number;
  method: WithdrawalMethod;
  /** Payout account reference — account NUMBER IS NEVER stored here, only a masked ref. */
  accountRefMasked: string;
  status: WithdrawalStatus;
  requestedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
}

export const withdrawalRequestSchema = z.object({
  amountPoisha: z.number().int().positive("Amount 0 er beshi hote hobe"),
  method: z.enum(["BKASH", "NAGAD", "BANK"]),
  /** Caller passes a masked reference (e.g. last 4 digits); never the full account number. */
  accountRefMasked: z.string().min(4).max(32),
});

export type WithdrawalRequestInput = z.infer<typeof withdrawalRequestSchema>;

/** Minimum withdrawal, poisha (BDT 500). */
export const MIN_WITHDRAWAL_POISHA = 50_000;

/** One row of the reseller dashboard. Phone is ALWAYS masked in this shape. */
export interface ResellerDashboard {
  resellerId: string;
  name: string;
  phoneMasked: string;
  tier: ResellerTier;
  /** Next tier + how much more lifetime sales (poisha) to reach it; null at GOLD. */
  nextTier: ResellerTier | null;
  toNextTierPoisha: number;
  commissionBps: number;
  lifetimeSalesPoisha: number;
  walletBalancePoisha: number;
  pendingWithdrawalPoisha: number;
  priceEntryCount: number;
}
