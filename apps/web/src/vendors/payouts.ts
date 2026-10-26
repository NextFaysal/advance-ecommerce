/**
 * Vendor payout requests — pure logic (schema wave 2). Mirrors the
 * reseller payout module (src/reseller/payouts.ts) deliberately: the
 * same balance model, the same state machine, the same honesty.
 * Integer poisha only.
 *
 * Balance model (COMPUTED, no hold-ledger entries):
 *   available = netPayable − Σ PAID requests − Σ (PENDING + APPROVED) requests
 * where netPayable is the commission read model's outstanding amount
 * (Σ commission-line vendor earnings − Σ refund chargebacks, never
 * below zero — see payout-store.ts). A PENDING or APPROVED request
 * HOLDS its amount; a PAID request has left the balance for good; a
 * REJECTED request frees its amount.
 *
 * PAID is a RECORD, not a transfer: it means a staff member recorded
 * that they paid the vendor externally (bKash/Nagad/bank). No money
 * moves through this module automatically.
 */
import { z } from "zod";

export type VendorPayoutMethod = "BKASH" | "NAGAD" | "BANK";
export type VendorPayoutStatus = "PENDING" | "APPROVED" | "PAID" | "REJECTED";
export type VendorPayoutDecision = "APPROVED" | "PAID" | "REJECTED";

export interface VendorPayoutRequest {
  id: string;
  vendorId: string;
  amountPoisha: number;
  method: VendorPayoutMethod;
  accountNote: string;
  status: VendorPayoutStatus;
  decidedById?: string;
  decidedAt?: string;
  paidAt?: string;
  note?: string;
  createdAt: string;
}

/** Minimum payout request, poisha — same ৳500 floor as resellers. */
export const VENDOR_MIN_PAYOUT_POISHA = 50_000;

export interface VendorPayoutBalances {
  /** Outstanding net payable from the commission read model. */
  netPayablePoisha: number;
  /** Σ PAID payout requests — money staff recorded as paid out externally. */
  paidOutPoisha: number;
  /** Σ PENDING + APPROVED payout requests — committed, not yet paid. */
  heldPoisha: number;
  /** netPayable − paidOut − held. Never negative by construction of the guards. */
  availablePoisha: number;
}

export function computeVendorPayoutBalances(
  netPayablePoisha: number,
  requests: readonly Pick<VendorPayoutRequest, "status" | "amountPoisha">[],
): VendorPayoutBalances {
  let paidOutPoisha = 0;
  let heldPoisha = 0;
  for (const r of requests) {
    if (r.status === "PAID") paidOutPoisha += r.amountPoisha;
    else if (r.status === "PENDING" || r.status === "APPROVED") heldPoisha += r.amountPoisha;
  }
  return {
    netPayablePoisha,
    paidOutPoisha,
    heldPoisha,
    availablePoisha: netPayablePoisha - paidOutPoisha - heldPoisha,
  };
}

/** Validate a new payout request against the computed balances. */
export function validateVendorPayoutAmount(
  amountPoisha: number,
  balances: VendorPayoutBalances,
): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(amountPoisha) || amountPoisha <= 0) {
    return { ok: false, error: "Payout amount must be a positive integer (poisha)." };
  }
  if (amountPoisha < VENDOR_MIN_PAYOUT_POISHA) {
    return { ok: false, error: `Minimum payout request is ${VENDOR_MIN_PAYOUT_POISHA} poisha (৳500).` };
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
export function decideVendorPayout(
  current: VendorPayoutStatus,
  action: VendorPayoutDecision,
): { ok: true; status: VendorPayoutStatus } | { ok: false; error: string } {
  if (current === "PAID" || current === "REJECTED") {
    return { ok: false, error: `Payout request is already ${current} — it cannot be decided again.` };
  }
  if (action === "PAID" && current !== "APPROVED") {
    return { ok: false, error: "Payout must be APPROVED before it can be marked PAID." };
  }
  return { ok: true, status: action };
}

/** Portal payout form payload. Method accepts bkash/nagad/bank in any case. */
export const vendorPayoutRequestInputSchema = z.object({
  amountPoisha: z.number().int().positive("Amount 0 er beshi hote hobe"),
  method: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(z.enum(["BKASH", "NAGAD", "BANK"])),
  /** Where to pay, in the vendor's own words (e.g. "bKash personal 01XXX…"). */
  accountNote: z.string().trim().min(4, "কোন অ্যাকাউন্টে পাঠাতে হবে লিখুন").max(200),
});

export type VendorPayoutRequestInput = z.infer<typeof vendorPayoutRequestInputSchema>;
