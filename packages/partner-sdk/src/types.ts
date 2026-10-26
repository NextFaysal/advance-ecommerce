/**
 * Response types for the partner API — these mirror the server
 * serialisers in `apps/web/src/webhooks/partner.ts` field for field.
 * If a field is not here, the server does not send it; in particular:
 *
 *  - products never carry cost fields (`costPoisha` is not selected
 *    at the database layer, so it can never appear);
 *  - orders never carry a customer name, address, email, or full
 *    phone — only `customerPhoneMasked`;
 *  - customers never carry credential or social-binding fields —
 *    only `phoneMasked`.
 *
 * All money amounts are integer poisha (100 poisha = ৳1 BDT), the
 * platform-wide money rule. Timestamps are ISO 8601 strings.
 */

export type PartnerScope = "products:read" | "orders:read" | "customers:read";

/**
 * Merchant-defined custom-field values (ADV-26 custom fields). The
 * key is present ONLY on rows that actually have values stored.
 * Value shapes depend on the merchant's own field definitions.
 */
export type PartnerCustomFields = Record<string, unknown>;

/* ------------------------------------------------------------------ */
/* Products — GET /api/v1/partner/products (scope: products:read)      */
/* ------------------------------------------------------------------ */

export interface PartnerProductVariant {
  id: string;
  sku: string;
  pricePoisha: number;
  compareAtPoisha: number | null;
  stock: number;
  isActive: boolean;
}

export interface PartnerProduct {
  id: string;
  slug: string;
  titleBn: string;
  titleEn: string;
  /** Canonical product status, e.g. "ACTIVE" | "DRAFT". */
  status: string;
  /** "SIMPLE" | "DIGITAL" | "BUNDLE" | "PREORDER". */
  type: string;
  priceOnRequest: boolean;
  tags: string[];
  /** ISO 8601. (The partner projection has no `createdAt`.) */
  updatedAt: string;
  variants: PartnerProductVariant[];
  customFields?: PartnerCustomFields;
}

/* ------------------------------------------------------------------ */
/* Orders — GET /api/v1/partner/orders (scope: orders:read)            */
/* ------------------------------------------------------------------ */

export interface PartnerOrderItem {
  productName: string;
  sku: string;
  unitPricePoisha: number;
  /**
   * Quantity serialised as a STRING ("1", "1.5") — quantities are
   * Decimal(12,3) server-side (weighted products sell in fractions)
   * and are never sent as floats.
   */
  quantity: string;
}

export interface PartnerOrder {
  id: string;
  orderNo: string;
  /** Canonical order status, e.g. "PENDING" | "CONFIRMED" | "DELIVERED". */
  status: string;
  /** e.g. "UNPAID" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED". */
  paymentStatus: string;
  paymentMethod: string | null;
  subtotalPoisha: number;
  discountPoisha: number;
  shippingPoisha: number;
  totalPoisha: number;
  /**
   * Masked by the server (`maskPhone`) — the full customer phone
   * number is never part of the partner surface.
   */
  customerPhoneMasked: string;
  /** Total quantity across lines (may be fractional, e.g. 2.5). */
  itemCount: number;
  items: PartnerOrderItem[];
  /** ISO 8601. */
  createdAt: string;
  customFields?: PartnerCustomFields;
}

/* ------------------------------------------------------------------ */
/* Customers — GET /api/v1/partner/customers (scope: customers:read)   */
/* ------------------------------------------------------------------ */

export interface PartnerCustomer {
  id: string;
  name: string;
  /** Masked by the server — the full phone number is never exposed. */
  phoneMasked: string;
  email: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** Lifetime stats count every recorded order, regardless of status. */
  lifetimeOrderCount: number;
  lifetimeTotalPoisha: number;
  customFields?: PartnerCustomFields;
}

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

/** The `meta` block every partner list response carries. */
export interface PartnerResponseMeta {
  scope: PartnerScope;
  note: string;
}

export interface ListOptions {
  /**
   * Page size. Server default 50, clamped to 1–200. The endpoints
   * return the most recent rows first and have no cursor/offset —
   * `limit` is the only paging control.
   */
  limit?: number;
}
