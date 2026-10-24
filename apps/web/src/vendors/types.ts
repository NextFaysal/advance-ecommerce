// Multi-vendor types — Agent 16, Step 48 (A12).
// Money integer poisha; commission rates in basis points (10000 bps = 100%).
export type VendorStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED";

export interface Vendor {
  id: string;
  shopName: string;
  ownerName: string;
  /** Normalized +8801XXXXXXXXX; display masked unless customers.view_full_phone. */
  phone: string;
  status: VendorStatus;
  /** Default commission for this vendor, basis points. */
  commissionBps: number;
  createdAt: string;
}

export type VendorProductApproval = "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";

export interface VendorProduct {
  id: string;
  vendorId: string;
  productName: string;
  sku: string;
  pricePoisha: number;
  approval: VendorProductApproval;
  rejectionReason?: string;
}

export type CommissionLine = {
  orderId: string;
  vendorId: string;
  grossPoisha: number;
  commissionBps: number;
  commissionPoisha: number;
  vendorEarningPoisha: number;
};

export type VendorPayoutSummary = {
  vendorId: string;
  orderCount: number;
  grossPoisha: number;
  commissionPoisha: number;
  /** Refunds reduce the payout; never below zero. */
  refundsPoisha: number;
  netPayablePoisha: number;
};
