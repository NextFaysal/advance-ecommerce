// Vendor commission, payout and product-approval logic — Agent 16. Pure.
// Commission rounding: floor to whole poisha (the platform never rounds a
// vendor's earning up at the platform's expense, and never invents poisha).
import { assertVendorEnabled } from "./flags";
import type {
  CommissionLine, Vendor, VendorPayoutSummary, VendorProduct, VendorProductApproval,
} from "./types";

export function computeCommission(orderId: string, vendor: Vendor, grossPoisha: number): CommissionLine {
  assertVendorEnabled();
  if (!Number.isInteger(grossPoisha) || grossPoisha < 0) {
    throw new Error("Gross amount must be a non-negative integer poisha.");
  }
  if (vendor.commissionBps < 0 || vendor.commissionBps > 10000) {
    throw new Error("Commission bps must be between 0 and 10000.");
  }
  const commissionPoisha = Math.floor((grossPoisha * vendor.commissionBps) / 10000);
  return {
    orderId,
    vendorId: vendor.id,
    grossPoisha,
    commissionBps: vendor.commissionBps,
    commissionPoisha,
    vendorEarningPoisha: grossPoisha - commissionPoisha,
  };
}

export function summarizePayout(
  vendorId: string,
  lines: readonly CommissionLine[],
  refundsPoisha: number,
): VendorPayoutSummary {
  assertVendorEnabled();
  const mine = lines.filter((l) => l.vendorId === vendorId);
  const grossPoisha = mine.reduce((s, l) => s + l.grossPoisha, 0);
  const commissionPoisha = mine.reduce((s, l) => s + l.commissionPoisha, 0);
  const net = grossPoisha - commissionPoisha - refundsPoisha;
  return {
    vendorId,
    orderCount: mine.length,
    grossPoisha,
    commissionPoisha,
    refundsPoisha,
    netPayablePoisha: Math.max(0, net),
  };
}

const APPROVAL_TRANSITIONS: Record<VendorProductApproval, readonly VendorProductApproval[]> = {
  PENDING_REVIEW: ["APPROVED", "REJECTED", "CHANGES_REQUESTED"],
  CHANGES_REQUESTED: ["PENDING_REVIEW"], // vendor edits and resubmits
  APPROVED: ["PENDING_REVIEW"], // any price/content edit sends it back to review
  REJECTED: ["PENDING_REVIEW"], // resubmission after fixing the rejection reason
};

export function productApprovalTransition(from: VendorProductApproval, to: VendorProductApproval): boolean {
  return APPROVAL_TRANSITIONS[from].includes(to);
}

/** Only APPROVED products of ACTIVE vendors may be sold on the storefront. */
export function isSellable(vendor: Vendor, product: VendorProduct): boolean {
  return vendor.status === "ACTIVE" && product.approval === "APPROVED" && product.vendorId === vendor.id;
}
