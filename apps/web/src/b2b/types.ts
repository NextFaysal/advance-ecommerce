// B2B types — Agent 16, Step 48 (A12). Money integer poisha; percentages basis points.
import { z } from "zod";

// ---- Wholesale pricing ----

export type PriceTier = {
  minQty: number;
  /** Unit price at this quantity break, integer poisha. */
  unitPricePoisha: number;
};

export type WholesalePriceList = {
  variantId: string;
  retailPricePoisha: number;
  /** Must be sorted ascending by minQty; each tier price <= the previous. */
  tiers: PriceTier[];
};

// ---- Quotation ----

export type QuotationStatus = "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "CONVERTED";

export type QuotationLine = {
  variantId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitPricePoisha: number;
};

export interface Quotation {
  id: string;
  b2bCustomerId: string;
  lines: QuotationLine[];
  totalPoisha: number;
  status: QuotationStatus;
  validUntil: string; // ISO date
  convertedOrderId?: string;
  createdAt: string;
  updatedAt: string;
}

export const quotationLineSchema = z.object({
  variantId: z.string().min(1),
  sku: z.string().min(1),
  productName: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPricePoisha: z.number().int().nonnegative(),
});

export const createQuotationSchema = z.object({
  b2bCustomerId: z.string().min(1),
  lines: z.array(quotationLineSchema).min(1),
  validUntil: z.string().min(1),
});

// ---- B2B customers / credit ----

export type B2bApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";

export interface B2bCustomer {
  id: string;
  businessName: string;
  contactName: string;
  /** Normalized +8801XXXXXXXXX; display masked unless customers.view_full_phone. */
  phone: string;
  tradeLicenseNo?: string;
  approvalStatus: B2bApprovalStatus;
  creditLimitPoisha: number;
  /** Outstanding invoiced amount not yet paid. */
  outstandingPoisha: number;
  /** Oldest unpaid invoice due date (ISO), if any. */
  oldestDueDate?: string;
  createdAt: string;
}

export type CreditCheck = {
  allowed: boolean;
  availablePoisha: number;
  overdue: boolean;
  reasons: string[];
};
