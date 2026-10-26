/**
 * Reseller payout requests — pure logic (ADV-12). Integer poisha only.
 *
 * Balance model (deliberately COMPUTED, no hold-ledger entries):
 *   available = walletBalance − Σ PAID requests − Σ (PENDING + APPROVED) requests
 * where walletBalance is the append-only wallet ledger sum (which
 * already nets out the legacy withdrawal flow's holds/releases). A
 * PENDING or APPROVED request HOLDS its amount; a PAID request has
 * left the balance for good; a REJECTED request frees its amount.
 * Because payout requests never write wallet entries, the two flows
 * can never double-count the same poisha.
 *
 * PAID is a RECORD, not a transfer: it means a staff member recorded
 * that they paid the reseller externally (bKash/Nagad/bank). No money
 * moves through this module automatically.
 */
import { z } from "zod";
import { MIN_WITHDRAWAL_POISHA } from "./types";

export type PayoutMethod = "BKASH" | "NAGAD" | "BANK";
export type PayoutStatus = "PENDING" | "APPROVED" | "PAID" | "REJECTED";
export type PayoutDecision = "APPROVED" | "PAID" | "REJECTED";

export interface PayoutRequest {
  id: string;
  resellerId: string;
  amountPoisha: number;
  method: PayoutMethod;
  accountNote: string;
  status: PayoutStatus;
  decidedById?: string;
  decidedAt?: string;
  createdAt: string;
}

/** Minimum payout request, poisha — same floor as wallet withdrawals (৳500). */
export const MIN_PAYOUT_POISHA = MIN_WITHDRAWAL_POISHA;

export interface PayoutBalances {
  /** Current wallet ledger balance (credits − legacy holds/releases). */
  walletBalancePoisha: number;
  /** Σ PAID payout requests — money staff recorded as paid out externally. */
  paidOutPoisha: number;
  /** Σ PENDING + APPROVED payout requests — committed, not yet paid. */
  heldPoisha: number;
  /** walletBalance − paidOut − held. Never negative by construction of the guards. */
  availablePoisha: number;
}

export function computePayoutBalances(
  walletBalancePoisha: number,
  requests: readonly Pick<PayoutRequest, "status" | "amountPoisha">[],
): PayoutBalances {
  let paidOutPoisha = 0;
  let heldPoisha = 0;
  for (const r of requests) {
    if (r.status === "PAID") paidOutPoisha += r.amountPoisha;
    else if (r.status === "PENDING" || r.status === "APPROVED") heldPoisha += r.amountPoisha;
  }
  return {
    walletBalancePoisha,
    paidOutPoisha,
    heldPoisha,
    availablePoisha: walletBalancePoisha - paidOutPoisha - heldPoisha,
  };
}

/** Validate a new payout request against the computed balances. */
export function validatePayoutAmount(
  amountPoisha: number,
  balances: PayoutBalances,
): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(amountPoisha) || amountPoisha <= 0) {
    return { ok: false, error: "Payout amount must be a positive integer (poisha)." };
  }
  if (amountPoisha < MIN_PAYOUT_POISHA) {
    return { ok: false, error: `Minimum payout request is ${MIN_PAYOUT_POISHA} poisha (৳500).` };
  }
  if (amountPoisha > balances.availablePoisha) {
    return {
      ok: false,
      error: `Requested ${amountPoisha} poisha exceeds the available balance of ${balances.availablePoisha} poisha.`,
    };
  }
  return { ok: true };
}

/**
 * Decision state machine: PENDING -> APPROVED, PENDING|APPROVED ->
 * REJECTED (frees the hold), APPROVED -> PAID (records an external
 * payment made by staff). PAID and REJECTED are terminal.
 */
export function decidePayout(
  current: PayoutStatus,
  action: PayoutDecision,
): { ok: true; status: PayoutStatus } | { ok: false; error: string } {
  if (current === "PAID" || current === "REJECTED") {
    return { ok: false, error: `Payout request is already ${current} — it cannot be decided again.` };
  }
  if (action === "PAID" && current !== "APPROVED") {
    return { ok: false, error: "Payout must be APPROVED before it can be marked PAID." };
  }
  return { ok: true, status: action };
}

/** Portal payout form payload. Method accepts bkash/nagad/bank in any case. */
export const payoutRequestInputSchema = z.object({
  amountPoisha: z.number().int().positive("Amount 0 er beshi hote hobe"),
  method: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(z.enum(["BKASH", "NAGAD", "BANK"])),
  /** Where to pay, in the reseller's own words (e.g. "bKash personal 01XXX…"). */
  accountNote: z.string().trim().min(4, "কোন অ্যাকাউন্টে পাঠাতে হবে লিখুন").max(200),
});

export type PayoutRequestInput = z.infer<typeof payoutRequestInputSchema>;
