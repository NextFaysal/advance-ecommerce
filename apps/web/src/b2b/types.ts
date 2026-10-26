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

// ---- Group pricing (ADV-14 remainder) ----

/**
 * Group pricing is a Setting document (`b2b.groups`), NOT schema:
 *   { groups: [{ id, name, discountBps }],
 *     assignments: { [b2bCustomerId]: groupId },
 *     overrides: { [groupId]: { [variantId]: pricePoisha } } }
 * A buyer belongs to at most one group. An override for the buyer's
 * group and variant beats the group discount; the discount beats the
 * catalogue price. All money stays integer poisha; discountBps is
 * basis points (10000 = 100%).
 */
export interface B2bPriceGroup {
  id: string;
  name: string;
  discountBps: number;
}

export interface B2bGroupsDoc {
  groups: B2bPriceGroup[];
  assignments: Record<string, string>;
  overrides: Record<string, Record<string, number>>;
}

export type B2bPricingSource = "override" | "group_discount" | "catalogue";

export interface B2bResolvedVariantPrice {
  variantId: string;
  cataloguePricePoisha: number;
  effectivePricePoisha: number;
  pricingSource: B2bPricingSource;
  group: B2bPriceGroup | null;
  /** The group discount actually applied (0 for override/catalogue). */
  discountBpsApplied: number;
}

/** One sellable variant on the B2B portal price list, group-priced. */
export interface B2bPortalProductVariant {
  productId: string;
  productSlug: string;
  productNameBn: string;
  productNameEn: string;
  variantId: string;
  sku: string;
  /** Display summary of the variant attributes ("Size: M · Colour: Red"). */
  attributesLabel: string;
  stock: number;
  cataloguePricePoisha: number;
  effectivePricePoisha: number;
  pricingSource: B2bPricingSource;
  priceOnRequest: boolean;
}

export interface B2bPortalPriceList {
  /** The buyer's assigned group, or null (catalogue prices apply). */
  group: B2bPriceGroup | null;
  products: B2bPortalProductVariant[];
}

// ---- Buyer-submitted quotation requests / RFQs (ADV-14 remainder) ----

/**
 * Buyer-submitted requests ARE Quotation rows (status DRAFT — the
 * codebase's unpriced/draft state) whose lines snapshot the buyer's
 * group price at submission time. The request-only fields (note,
 * desired date, source) have no Quotation columns, so they live in a
 * companion Setting doc (`b2b.rfq_requests`) keyed by quotation id —
 * the same reason buyer conversions cannot rely on the staff
 * AuditLog (see src/privacy/ledger.ts): this doc is the guaranteed,
 * queryable record, and its presence is the source marker staff see.
 */
export interface B2bQuotationRequestMeta {
  source: "BUYER_RFQ";
  channel: "PORTAL_FORM" | "BULK_CSV";
  note: string;
  /** Desired delivery/fulfilment date (yyyy-mm-dd), NOT a quote expiry. */
  desiredDate: string | null;
  submittedAt: string;
  /** Customer-account id (customer_session identity), for support. */
  submittedByCustomerId: string;
  /** Whether the companion actorId:null AuditLog row was written. */
  auditLogWritten: boolean;
}

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
