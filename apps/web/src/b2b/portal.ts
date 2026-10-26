/**
 * B2B buyer portal — read models + buyer actions (ADV-14, doc 22).
 *
 * Server-only (imports the Prisma client). The portal lives INSIDE the
 * customer account (customer_session, src/customer-auth): a B2B buyer
 * is a Customer whose PHONE also carries a B2bCustomer row — both
 * tables key identity by the same unique, normalized phone, and the
 * wave-27 conversion already matches B2B accounts to orders by phone.
 * There is deliberately NO separate B2B login and NO new schema.
 *
 * OWNERSHIP: every function here takes the session's PublicCustomer
 * and resolves ONLY that customer's B2B profile (by phone), their
 * quotations (by b2bCustomerId) and their orders (by customerId). A
 * quotation belonging to another B2B account is a 404, never a leak.
 *
 * MONEY: integer poisha throughout. Dashboard credit-used is
 * B2bCustomer.duePoisha AS RECORDED on the account row (the ledger
 * the conversion increments); available credit is computed from it
 * and labelled as computed. Per-order dues are computed from real
 * Payment / Refund rows with the same formula the conversion uses
 * (src/orders/convert.ts b2bOutstandingPoisha) — nothing is invented.
 *
 * ACCEPT: the buyer's accept flips their SENT quotation to ACCEPTED
 * (the same transition the admin PATCH route allows) and then calls
 * the wave-27 conversion service convertQuotation() UNCHANGED — the
 * credit rules (409 CREDIT_LIMIT_EXCEEDED / CREDIT_OVERDUE /
 * CUSTOMER_NOT_APPROVED, ACCEPTED-only) live there and are never
 * re-implemented here.
 */
import { prisma } from "@advance-ecommerce/db";
import { isFeatureEnabled } from "@/lib/feature-flags";
import type { PublicCustomer } from "@/customer-auth/auth";
import { b2bStore } from "./db-store";
import { readB2bRequestMetaMap } from "./requests";
import { checkCredit, effectiveQuotationStatus, quotationTransition } from "./service";
import type {
  B2bCustomer,
  B2bQuotationRequestMeta,
  Quotation,
  QuotationLine,
  QuotationStatus,
} from "./types";
import { convertQuotation, type ConvertOptions } from "@/orders/convert";

export const B2B_PORTAL_FLAG = "module.b2b_portal";

export function isB2bPortalEnabled(): boolean {
  return isFeatureEnabled(B2B_PORTAL_FLAG);
}

/* ------------------------------------------------------------------ */
/* Profile resolution                                                  */
/* ------------------------------------------------------------------ */

/**
 * The B2B profile for a phone, or null when the phone has no B2B
 * account. Resolution goes through b2bStore.getCustomer so the field
 * mapping (companyName → businessName, duePoisha → outstandingPoisha,
 * status normalisation) stays the ONE canonical mapping.
 */
export async function getB2bProfileByPhone(phone: string): Promise<B2bCustomer | null> {
  const row = await prisma.b2bCustomer.findFirst({
    where: { phone, deletedAt: null },
    select: { id: true },
  });
  if (!row) return null;
  const customer = await b2bStore.getCustomer(row.id);
  return customer ?? null;
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export interface B2bPortalCompany {
  id: string;
  businessName: string;
  contactName: string;
  /** Masked display is the page's job; this is the account's own phone. */
  phone: string;
  tradeLicenseNo: string | null;
  approvalStatus: B2bCustomer["approvalStatus"];
  creditLimitPoisha: number;
  /** Credit used — B2bCustomer.duePoisha as recorded on the account. */
  creditUsedPoisha: number;
  /** Computed: max(0, creditLimit − creditUsed). হিসাব — not a stored figure. */
  availableCreditPoisha: number;
  oldestDueDate: string | null;
  /** Wave-7 rule (checkCredit): oldest due date in the past AND dues > 0. */
  overdue: boolean;
  memberSince: string;
}

export interface B2bPortalQuotation {
  id: string;
  lines: QuotationLine[];
  totalPoisha: number;
  status: QuotationStatus;
  /** Status after the past-validUntil → EXPIRED read rule is applied. */
  effectiveStatus: QuotationStatus;
  validUntil: string;
  convertedOrderId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Buyer-RFQ marker from the `b2b.rfq_requests` Setting doc
   *  (src/b2b/requests.ts); null for staff-created quotations. */
  request: B2bQuotationRequestMeta | null;
}

export interface B2bPortalOrder {
  id: string;
  orderNo: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  /** Order.source — "b2b" marks a quotation-converted credit order. */
  source: string | null;
  isB2bCreditOrder: boolean;
  totalPoisha: number;
  /** Σ Payment.paidPoisha over the order's real payment rows. */
  paidPoisha: number;
  /** Computed remaining: total − paid + money-moved refunds (0 for
   *  CANCELLED / REFUNDED orders). Same formula as the conversion. */
  duePoisha: number;
  createdAt: string;
}

export interface B2bPortalDashboard {
  company: B2bPortalCompany;
  quotations: B2bPortalQuotation[];
  orders: B2bPortalOrder[];
}

const QUOTATION_STATUSES: readonly QuotationStatus[] = [
  "DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CONVERTED",
];

function toPortalQuotation(row: {
  id: string;
  itemsJson: unknown;
  totalPoisha: number;
  status: string;
  validUntil: Date | null;
  convertedOrderId: string | null;
  createdAt: Date;
  updatedAt: Date;
}, todayIso: string, request: B2bQuotationRequestMeta | null = null): B2bPortalQuotation {
  const lines = Array.isArray(row.itemsJson) ? (row.itemsJson as unknown as QuotationLine[]) : [];
  const status = QUOTATION_STATUSES.includes(row.status as QuotationStatus)
    ? (row.status as QuotationStatus)
    : "DRAFT";
  const base: Quotation = {
    id: row.id,
    b2bCustomerId: "",
    lines,
    totalPoisha: row.totalPoisha,
    status,
    validUntil: row.validUntil ? row.validUntil.toISOString().slice(0, 10) : "",
    convertedOrderId: row.convertedOrderId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  return {
    id: base.id,
    lines: base.lines,
    totalPoisha: base.totalPoisha,
    status: base.status,
    // A buyer RFQ in DRAFT is a REQUEST, not an offer — its stored
    // validUntil is a placeholder (src/b2b/requests.ts), so it never
    // reads as EXPIRED while it waits for staff pricing.
    effectiveStatus:
      request !== null && base.status === "DRAFT"
        ? "DRAFT"
        : effectiveQuotationStatus(base, todayIso),
    validUntil: base.validUntil,
    convertedOrderId: base.convertedOrderId ?? null,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    request,
  };
}

export async function listB2bPortalQuotations(profile: B2bCustomer): Promise<B2bPortalQuotation[]> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [rows, requestMeta] = await Promise.all([
    prisma.quotation.findMany({
      where: { b2bCustomerId: profile.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    readB2bRequestMetaMap(),
  ]);
  return rows.map((r) => toPortalQuotation(r, todayIso, requestMeta[r.id] ?? null));
}

/** One quotation, ownership-checked: another account's id reads as null. */
export async function getB2bPortalQuotation(
  profile: B2bCustomer,
  quotationId: string,
): Promise<B2bPortalQuotation | null> {
  const row = await prisma.quotation.findFirst({
    where: { id: quotationId, b2bCustomerId: profile.id, deletedAt: null },
  });
  if (!row) return null;
  const requestMeta = await readB2bRequestMetaMap();
  return toPortalQuotation(row, new Date().toISOString().slice(0, 10), requestMeta[row.id] ?? null);
}

export async function listB2bPortalOrders(customerId: string): Promise<B2bPortalOrder[]> {
  const orders = await prisma.order.findMany({
    where: { customerId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true, orderNo: true, status: true, paymentStatus: true,
      paymentMethod: true, source: true, totalPoisha: true, createdAt: true,
    },
  });
  const out: B2bPortalOrder[] = [];
  for (const order of orders) {
    const [paid, refunded] = await Promise.all([
      prisma.payment.aggregate({
        where: { orderId: order.id, deletedAt: null },
        _sum: { paidPoisha: true },
      }),
      prisma.refund.aggregate({
        where: { orderId: order.id, status: { in: ["SENT", "CONFIRMED", "COMPLETED"] } },
        _sum: { amountPoisha: true },
      }),
    ]);
    const paidPoisha = paid._sum.paidPoisha ?? 0;
    const closed = order.status === "CANCELLED" || order.status === "REFUNDED";
    const duePoisha = closed
      ? 0
      : Math.max(0, order.totalPoisha - paidPoisha + (refunded._sum.amountPoisha ?? 0));
    out.push({
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      source: order.source,
      isB2bCreditOrder: order.source === "b2b",
      totalPoisha: order.totalPoisha,
      paidPoisha,
      duePoisha,
      createdAt: order.createdAt.toISOString(),
    });
  }
  return out;
}

export async function buildB2bPortalDashboard(
  customer: PublicCustomer,
  profile: B2bCustomer,
): Promise<B2bPortalDashboard> {
  const todayIso = new Date().toISOString().slice(0, 10);
  // The wave-7 credit rule, reused — not re-derived: overdue-by-date
  // and available credit for a zero-size prospective order.
  const credit = checkCredit(profile, 0, todayIso);
  const [quotations, orders] = await Promise.all([
    listB2bPortalQuotations(profile),
    listB2bPortalOrders(customer.id),
  ]);
  return {
    company: {
      id: profile.id,
      businessName: profile.businessName,
      contactName: profile.contactName,
      phone: profile.phone,
      tradeLicenseNo: profile.tradeLicenseNo ?? null,
      approvalStatus: profile.approvalStatus,
      creditLimitPoisha: profile.creditLimitPoisha,
      creditUsedPoisha: profile.outstandingPoisha,
      availableCreditPoisha: credit.availablePoisha,
      oldestDueDate: profile.oldestDueDate ?? null,
      overdue: credit.overdue,
      memberSince: profile.createdAt,
    },
    quotations,
    orders,
  };
}

/* ------------------------------------------------------------------ */
/* Buyer actions                                                       */
/* ------------------------------------------------------------------ */

export type B2bPortalActionResult =
  | {
      ok: true;
      httpStatus: number;
      alreadyConverted?: boolean;
      orderId?: string;
      orderNo?: string;
      quotationTotalPoisha?: number;
      outstandingPoisha?: number;
      creditLimitPoisha?: number;
      quotation?: B2bPortalQuotation;
    }
  | { ok: false; httpStatus: number; code: string; message: string; details?: unknown };

function actionFail(
  httpStatus: number, code: string, message: string, details?: unknown,
): B2bPortalActionResult {
  return { ok: false, httpStatus, code, message, details };
}

/**
 * Buyer accepts a quotation: SENT → ACCEPTED (the admin PATCH route's
 * own transition table), then the wave-27 convertQuotation() service
 * creates the real order and enforces the credit rules. An already-
 * ACCEPTED quotation goes straight to conversion (retry-safe); a
 * CONVERTED one replays to its order through the same service.
 */
export async function acceptB2bQuotation(
  customer: PublicCustomer,
  profile: B2bCustomer,
  quotationId: string,
  opts: ConvertOptions = {},
  reqMeta: { ip?: string; userAgent?: string } = {},
): Promise<B2bPortalActionResult> {
  const owned = await getB2bPortalQuotation(profile, quotationId);
  if (!owned) {
    return actionFail(404, "QUOTATION_NOT_FOUND", "কোটেশন পাওয়া যায়নি। / Quotation not found.");
  }
  if (owned.effectiveStatus === "EXPIRED") {
    return actionFail(
      409, "QUOTATION_EXPIRED",
      "কোটেশনটির মেয়াদ শেষ হয়ে গেছে — নতুন কোটেশনের জন্য স্টোরে যোগাযোগ করুন। / This quotation has expired — ask the store for a fresh quotation.",
      { status: owned.status, validUntil: owned.validUntil },
    );
  }
  if (owned.status === "SENT") {
    if (!quotationTransition("SENT", "ACCEPTED")) {
      return actionFail(422, "INVALID_TRANSITION", "Quotation cannot move SENT -> ACCEPTED.");
    }
    const stored = await b2bStore.getQuotation(quotationId);
    if (!stored) {
      return actionFail(404, "QUOTATION_NOT_FOUND", "কোটেশন পাওয়া যায়নি। / Quotation not found.");
    }
    await b2bStore.replaceQuotation({
      ...stored, status: "ACCEPTED", updatedAt: new Date().toISOString(),
    });
  } else if (owned.status !== "ACCEPTED" && owned.status !== "CONVERTED") {
    return actionFail(
      409, "QUOTATION_NOT_ACCEPTABLE",
      `এই অবস্থায় কোটেশন গ্রহণ করা যায় না (বর্তমান অবস্থা ${owned.status}) — শুধু পাঠানো (SENT) কোটেশন গ্রহণ করা যায়। / Only a SENT quotation can be accepted — current status is ${owned.status}.`,
      { status: owned.status },
    );
  }

  const result = await convertQuotation(
    quotationId,
    { id: customer.id, permissions: [], ip: reqMeta.ip, userAgent: reqMeta.userAgent },
    opts,
  );
  if (!result.ok) {
    return actionFail(result.httpStatus, result.code, result.message, result.details);
  }
  return {
    ok: true,
    httpStatus: result.alreadyConverted ? 200 : 201,
    alreadyConverted: result.alreadyConverted,
    orderId: result.orderId,
    orderNo: result.orderNo,
    quotationTotalPoisha: result.quotationTotalPoisha,
    outstandingPoisha: result.outstandingPoisha,
    creditLimitPoisha: result.creditLimitPoisha,
  };
}

/**
 * Buyer declines a quotation: SENT → REJECTED, the model's declined
 * state, through the same transition table the admin route enforces.
 */
export async function declineB2bQuotation(
  profile: B2bCustomer,
  quotationId: string,
): Promise<B2bPortalActionResult> {
  const owned = await getB2bPortalQuotation(profile, quotationId);
  if (!owned) {
    return actionFail(404, "QUOTATION_NOT_FOUND", "কোটেশন পাওয়া যায়নি। / Quotation not found.");
  }
  if (!quotationTransition(owned.status, "REJECTED")) {
    return actionFail(
      422, "INVALID_TRANSITION",
      `এই অবস্থায় কোটেশন প্রত্যাখ্যান করা যায় না (বর্তমান অবস্থা ${owned.status})। / Quotation cannot move ${owned.status} -> REJECTED.`,
      { status: owned.status },
    );
  }
  const stored = await b2bStore.getQuotation(quotationId);
  if (!stored) {
    return actionFail(404, "QUOTATION_NOT_FOUND", "কোটেশন পাওয়া যায়নি। / Quotation not found.");
  }
  await b2bStore.replaceQuotation({
    ...stored, status: "REJECTED", updatedAt: new Date().toISOString(),
  });
  const updated = await getB2bPortalQuotation(profile, quotationId);
  return { ok: true, httpStatus: 200, quotation: updated ?? owned };
}
