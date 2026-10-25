/**
 * Conversion services — doc 17 batch O9 (part 1): B2B quotations and
 * preorders become REAL Orders.
 *
 * Until this batch both record families were side records: quotations
 * stopped at ACCEPTED, preorders stopped at a deposit figure, and the
 * money / stock / delivery funnels never saw them. These two services
 * are the bridges. Both create through createManualOrder (the one
 * staff create funnel — catalog snapshots, stock reservation, fraud
 * scoring, shipping engine) and both are idempotent by construction:
 * a deterministic idempotency key per source record + a guarded
 * status flip on the source row, so a retry returns the SAME order.
 *
 * B2B MONEY / CREDIT RULES (convertQuotation):
 *  - Lines are priced at the QUOTATION's agreed unit prices — a
 *    quotation price is a contract, never re-priced from the catalog
 *    (manual-create records the difference from catalog on the note).
 *  - paymentMethod: the manual-create enum has no "b2b_credit" value,
 *    so credit orders ride as "cod" (pay later); the due itself is
 *    tracked on the B2B account (duePoisha incremented by the order
 *    total on conversion).
 *  - OUTSTANDING (for enforcement) = Σ remaining over the account's
 *    B2B orders: source "b2b", matched to the account by its unique
 *    phone, not CANCELLED, paymentStatus UNPAID / PARTIAL /
 *    PARTIALLY_REFUNDED; remaining per order =
 *    totalPoisha − Σ Payment.paidPoisha + Σ money-moved refunds.
 *  - The wave-7 rule itself is NOT re-implemented: the computed
 *    outstanding is fed into checkCredit() (src/b2b/service.ts) with
 *    the quotation total. Its overdue-by-date branch (oldestDueDate
 *    in the past AND outstanding > 0) maps to 409 CREDIT_OVERDUE; the
 *    limit branch maps to 409 CREDIT_LIMIT_EXCEEDED; a non-APPROVED
 *    account maps to 409 CUSTOMER_NOT_APPROVED. Every refusal carries
 *    all three numbers: outstanding, this total, the credit limit.
 *
 * PREORDER MONEY RULES (fulfilPreorder):
 *  - The PreOrder row carries the deposit ONLY as depositPoisha — no
 *    Payment row exists for it anywhere (verified: the advanced-orders
 *    store writes no payments). Fulfilment therefore records the
 *    deposit on the new order as a credit Payment (the exchange-credit
 *    pattern: method COD, gatewayTransactionId anchor
 *    "preorder-deposit:<preorderId>") + markOrderPayment with source
 *    "preorder_deposit".
 *  - DEDUPE against the advance engine: the public checkout computes
 *    a preorder-deposit advance candidate, but createManualOrder does
 *    NOT — its only deposit-shaped input is the staff-set
 *    advanceRequiredPoisha. Fulfilment passes depositPoisha there, so
 *    the persisted requirement IS the deposit (never a second,
 *    independently-computed amount), and the credit Payment of the
 *    same amount satisfies it exactly once via markOrderPayment's
 *    advanceSatisfiedAt stamp. Order payable = total − deposit.
 *  - LINK WART (doc 18 batch F3): manual-create issues an advance
 *    payment link for any persisted requirement, which would leave a
 *    LIVE deposit link on the fulfilment order until the credit
 *    below lands — a customer could open it and pay the deposit
 *    twice. Fulfilment therefore passes advanceLinkPolicy
 *    "suppress": no link is ever issued for a fulfilment order; the
 *    deposit credit is the only money path.
 *  - Price: the row's snapshot — totalPoisha is the only money column,
 *    unit price = floor(totalPoisha / quantity), the same read the
 *    advanced-orders store uses.
 *  - Eligible statuses: the DB enum's DEPOSIT_PAID and READY. OPEN
 *    means no deposit was recorded as paid and nothing says the stock
 *    arrived, so it is refused (PREORDER_NOT_READY). Fulfilment moves
 *    the row to FULFILLED (the enum's terminal state — there is no
 *    CONVERTED value) and stores the order link in convertedOrderId.
 *
 * ADDRESSES: neither record family stores a delivery address, and a
 * manual order cannot be created without one. Resolution order:
 * caller-supplied address → the customer's saved Address row
 * (default first) → the address snapshot of the customer's most
 * recent non-cancelled order → 422 ADDRESS_REQUIRED. Nothing is
 * invented.
 */
import { createHash } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import { writeAudit } from "@/lib/audit";
import { b2bStore } from "@/b2b/db-store";
import { checkCredit } from "@/b2b/service";
import type { QuotationLine } from "@/b2b/types";
import type { BdAddress } from "@/checkout/validation";
import { addOrderTimelineNote } from "@/shipments/split-shipments";
import {
  createManualOrder,
  type ManualOrderActor,
} from "./manual-create";
import { markOrderPayment } from "./repository";

export type ConvertActor = ManualOrderActor;

export interface ConvertOptions {
  address?: BdAddress;
  shippingMethod?: "inside_dhaka" | "outside_dhaka" | "pickup";
}

type Fail = {
  ok: false;
  httpStatus: number;
  code: string;
  message: string;
  details?: unknown;
};

function fail(httpStatus: number, code: string, message: string, details?: unknown): Fail {
  return { ok: false, httpStatus, code, message, details };
}

/** Deterministic UUID-shaped idempotency key per source record —
 *  the exchange module's derivation, namespaced per conversion kind. */
function conversionIdempotencyKey(namespace: string, sourceId: string): string {
  const h = createHash("sha256").update(`${namespace}:${sourceId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function resolveCustomerAddress(
  customerId: string | null,
  phone: string,
): Promise<BdAddress | null> {
  if (customerId) {
    const saved = await prisma.address.findFirst({
      where: { customerId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    if (saved) {
      return {
        division: saved.division,
        district: saved.district,
        upazila: saved.upazila,
        ...(saved.union ? { union: saved.union } : {}),
        addressLine: saved.addressLine,
      };
    }
  }
  const lastOrder = await prisma.order.findFirst({
    where: { customerPhone: phone, deletedAt: null, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    select: { division: true, district: true, upazila: true, union: true, addressLine: true },
  });
  if (lastOrder) {
    return {
      division: lastOrder.division,
      district: lastOrder.district,
      upazila: lastOrder.upazila,
      ...(lastOrder.union ? { union: lastOrder.union } : {}),
      addressLine: lastOrder.addressLine,
    };
  }
  return null;
}

function shippingForDistrict(
  district: string,
  explicit?: ConvertOptions["shippingMethod"],
): "inside_dhaka" | "outside_dhaka" | "pickup" {
  if (explicit) return explicit;
  return district.trim().toLowerCase() === "dhaka" ? "inside_dhaka" : "outside_dhaka";
}

const ADDRESS_REQUIRED_MESSAGE =
  "ডেলিভারির ঠিকানা পাওয়া যায়নি — গ্রাহকের কোনো সংরক্ষিত ঠিকানা বা আগের অর্ডারের ঠিকানা নেই; ঠিকানা দিয়ে আবার চেষ্টা করুন। / No delivery address on file — the customer has no saved address and no previous order address; supply an address and retry.";

/* ------------------------------------------------------------------ */
/* B2B quotation -> order                                              */
/* ------------------------------------------------------------------ */

export type ConvertQuotationResult =
  | {
      ok: true;
      alreadyConverted: boolean;
      orderId: string;
      orderNo: string;
      quotationTotalPoisha: number;
      /** Outstanding BEFORE this conversion (order-derived, see header). */
      outstandingPoisha: number;
      creditLimitPoisha: number;
    }
  | Fail;

/** Σ remaining over the account's unpaid/partial B2B orders. */
async function b2bOutstandingPoisha(phone: string): Promise<number> {
  const orders = await prisma.order.findMany({
    where: {
      customerPhone: phone,
      source: "b2b",
      deletedAt: null,
      status: { notIn: ["CANCELLED", "REFUNDED"] },
      paymentStatus: { in: ["UNPAID", "PARTIAL", "PARTIALLY_REFUNDED"] },
    },
    select: { id: true, totalPoisha: true },
  });
  let outstanding = 0;
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
    const remaining =
      order.totalPoisha - (paid._sum.paidPoisha ?? 0) + (refunded._sum.amountPoisha ?? 0);
    outstanding += Math.max(0, remaining);
  }
  return outstanding;
}

export async function convertQuotation(
  quotationId: string,
  actor: ConvertActor,
  opts: ConvertOptions = {},
): Promise<ConvertQuotationResult> {
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, deletedAt: null },
  });
  if (!quotation) {
    return fail(404, "QUOTATION_NOT_FOUND", "কোটেশন পাওয়া যায়নি। / Quotation not found.");
  }

  // Idempotent replay: a converted quotation returns its order.
  if (quotation.status === "CONVERTED" && quotation.convertedOrderId) {
    const order = await prisma.order.findFirst({
      where: { id: quotation.convertedOrderId, deletedAt: null },
      select: { id: true, orderNo: true },
    });
    if (order) {
      const customer = await b2bStore.getCustomer(quotation.b2bCustomerId);
      return {
        ok: true,
        alreadyConverted: true,
        orderId: order.id,
        orderNo: order.orderNo,
        quotationTotalPoisha: quotation.totalPoisha,
        outstandingPoisha: customer ? await b2bOutstandingPoisha(customer.phone) : 0,
        creditLimitPoisha: customer?.creditLimitPoisha ?? 0,
      };
    }
  }
  if (quotation.status !== "ACCEPTED") {
    return fail(
      409,
      "QUOTATION_NOT_ACCEPTED",
      `শুধু ACCEPTED কোটেশন অর্ডারে রূপান্তর করা যায় — বর্তমান অবস্থা ${quotation.status}। / Only an ACCEPTED quotation can be converted — current status is ${quotation.status}.`,
      { status: quotation.status },
    );
  }

  const customerRow = await prisma.b2bCustomer.findFirst({
    where: { id: quotation.b2bCustomerId, deletedAt: null },
  });
  const customer = await b2bStore.getCustomer(quotation.b2bCustomerId);
  if (!customerRow || !customer) {
    return fail(404, "CUSTOMER_NOT_FOUND", "B2B গ্রাহক পাওয়া যায়নি। / B2B customer not found.");
  }

  const lines = Array.isArray(quotation.itemsJson)
    ? (quotation.itemsJson as unknown as QuotationLine[])
    : [];
  if (lines.length === 0) {
    return fail(422, "QUOTATION_EMPTY", "কোটেশনে কোনো লাইন নেই। / The quotation has no lines.");
  }
  const quotationTotalPoisha = quotation.totalPoisha;

  // ---- Credit enforcement (wave-7 checkCredit, order-derived outstanding)
  const outstandingPoisha = await b2bOutstandingPoisha(customer.phone);
  const todayIso = new Date().toISOString().slice(0, 10);
  const credit = checkCredit(
    { ...customer, outstandingPoisha },
    quotationTotalPoisha,
    todayIso,
  );
  const creditNumbers = {
    outstandingPoisha,
    quotationTotalPoisha,
    creditLimitPoisha: customer.creditLimitPoisha,
    availablePoisha: credit.availablePoisha,
  };
  if (credit.overdue) {
    return fail(
      409,
      "CREDIT_OVERDUE",
      `এই B2B অ্যাকাউন্টের মেয়াদোত্তীর্ণ বকেয়া আছে — আগে বকেয়া পরিশোধ না হলে নতুন ক্রেডিট অর্ডার করা যাবে না। বকেয়া ${outstandingPoisha} পয়সা, এই কোটেশন ${quotationTotalPoisha} পয়সা, ক্রেডিট সীমা ${customer.creditLimitPoisha} পয়সা। / This B2B account has overdue dues — no new credit order until cleared. Outstanding ${outstandingPoisha} poisha, this quotation ${quotationTotalPoisha} poisha, credit limit ${customer.creditLimitPoisha} poisha.`,
      creditNumbers,
    );
  }
  if (customer.approvalStatus !== "APPROVED") {
    return fail(
      409,
      "CUSTOMER_NOT_APPROVED",
      `B2B গ্রাহক APPROVED নন (বর্তমান অবস্থা ${customer.approvalStatus}) — ক্রেডিট অর্ডার করা যাবে না। বকেয়া ${outstandingPoisha} পয়সা, এই কোটেশন ${quotationTotalPoisha} পয়সা, ক্রেডিট সীমা ${customer.creditLimitPoisha} পয়সা। / The B2B customer is not APPROVED (status ${customer.approvalStatus}) — no credit order. Outstanding ${outstandingPoisha} poisha, this quotation ${quotationTotalPoisha} poisha, credit limit ${customer.creditLimitPoisha} poisha.`,
      creditNumbers,
    );
  }
  if (!credit.allowed) {
    return fail(
      409,
      "CREDIT_LIMIT_EXCEEDED",
      `ক্রেডিট সীমা ছাড়িয়ে যাবে: বকেয়া ${outstandingPoisha} + এই কোটেশন ${quotationTotalPoisha} > ক্রেডিট সীমা ${customer.creditLimitPoisha} পয়সা। / Credit limit exceeded: outstanding ${outstandingPoisha} + this quotation ${quotationTotalPoisha} > credit limit ${customer.creditLimitPoisha} poisha.`,
      creditNumbers,
    );
  }

  // ---- Address (nothing is invented — see header)
  const customerRecord = await prisma.customer.findFirst({
    where: { phone: customer.phone, deletedAt: null },
    select: { id: true },
  });
  const address =
    opts.address ?? (await resolveCustomerAddress(customerRecord?.id ?? null, customer.phone));
  if (!address) {
    return fail(422, "ADDRESS_REQUIRED", ADDRESS_REQUIRED_MESSAGE);
  }

  // ---- Create the real order at the quotation's contract prices
  const created = await createManualOrder(
    {
      phone: customer.phone,
      customerName: customer.contactName || customer.businessName,
      address,
      items: lines.map((l) => ({
        variantId: l.variantId,
        quantity: l.quantity,
        unitPricePoisha: l.unitPricePoisha,
      })),
      paymentMethod: "cod",
      shippingMethod: shippingForDistrict(address.district, opts.shippingMethod),
      source: "b2b",
      internalNote: `B2B কোটেশন ${quotation.id} থেকে রূপান্তরিত — কোটেশনের সম্মত দামই চূড়ান্ত (ক্যাটালগে পুনঃমূল্যায়ন হয়নি)। ক্রেডিট অর্ডার: পেমেন্ট B2B অ্যাকাউন্টের শর্ত অনুযায়ী বকেয়া। / Converted from B2B quotation ${quotation.id} at the quotation's agreed contract prices (not re-priced from the catalog). Credit order: payable on the B2B account's terms.`,
      idempotencyKey: conversionIdempotencyKey("b2b-quotation", quotation.id),
    },
    actor,
  );
  if (!created.ok) {
    return fail(created.httpStatus, created.code, created.message, created.details);
  }

  // ---- Mark CONVERTED + link, exactly once (guarded flip). The flip
  // is also what increments the account's due ledger, so a replay that
  // finds the flip already done never double-counts the due.
  const orderRow = await prisma.order.findFirst({
    where: { id: created.orderId },
    select: { totalPoisha: true },
  });
  const orderTotalPoisha = orderRow?.totalPoisha ?? quotationTotalPoisha;
  const flip = await prisma.quotation.updateMany({
    where: { id: quotation.id, status: "ACCEPTED" },
    data: { status: "CONVERTED", convertedOrderId: created.orderId },
  });
  if (flip.count === 1) {
    await prisma.b2bCustomer.update({
      where: { id: customerRow.id },
      data: { duePoisha: { increment: orderTotalPoisha } },
    });
  }

  await addOrderTimelineNote(
    created.orderId,
    `B2B কোটেশন ${quotation.id} থেকে তৈরি ক্রেডিট অর্ডার — কোটেশন মূল্য ${quotationTotalPoisha} পয়সা, অর্ডারের মোট ${orderTotalPoisha} পয়সা অ্যাকাউন্টের বকেয়ায় যোগ হয়েছে। / Credit order created from B2B quotation ${quotation.id} — quotation value ${quotationTotalPoisha} poisha; order total ${orderTotalPoisha} poisha added to the account's outstanding dues.`,
  );
  await writeAudit({
    actorId: actor.id,
    action: "b2b.quotation_convert",
    entityType: "Quotation",
    entityId: quotation.id,
    beforeJson: { status: "ACCEPTED" },
    afterJson: {
      status: "CONVERTED",
      orderId: created.orderId,
      orderNo: created.orderNo,
      quotationTotalPoisha,
      orderTotalPoisha,
      outstandingBeforePoisha: outstandingPoisha,
      creditLimitPoisha: customer.creditLimitPoisha,
      replayed: created.replayed,
    },
  });

  return {
    ok: true,
    alreadyConverted: created.replayed,
    orderId: created.orderId,
    orderNo: created.orderNo,
    quotationTotalPoisha,
    outstandingPoisha,
    creditLimitPoisha: customer.creditLimitPoisha,
  };
}

/* ------------------------------------------------------------------ */
/* PreOrder -> order (fulfilment)                                      */
/* ------------------------------------------------------------------ */

export type FulfilPreorderResult =
  | {
      ok: true;
      alreadyConverted: boolean;
      orderId: string;
      orderNo: string;
      orderTotalPoisha: number;
      depositCreditedPoisha: number;
      /** Still payable on the order = total − credited deposit. */
      payablePoisha: number;
      advanceRequiredPoisha: number;
      /** True when the deposit credit stamped advanceSatisfiedAt. */
      advanceSatisfied: boolean;
    }
  | Fail;

const PREORDER_FULFILABLE = ["DEPOSIT_PAID", "READY"] as const;

export async function fulfilPreorder(
  preorderId: string,
  actor: ConvertActor,
  opts: ConvertOptions = {},
): Promise<FulfilPreorderResult> {
  const pre = await prisma.preOrder.findFirst({
    where: { id: preorderId, deletedAt: null },
  });
  if (!pre) {
    return fail(404, "PREORDER_NOT_FOUND", "প্রি-অর্ডার পাওয়া যায়নি। / Pre-order not found.");
  }

  // Idempotent replay: a fulfilled pre-order returns its order + the
  // deposit state as recorded on it.
  if (pre.status === "FULFILLED") {
    if (!pre.convertedOrderId) {
      return fail(
        409,
        "PREORDER_ALREADY_FULFILLED_UNLINKED",
        "এই প্রি-অর্ডারটি আগেই FULFILLED চিহ্নিত কিন্তু কোনো অর্ডারের সঙ্গে যুক্ত নয় — ম্যানুয়ালি যাচাই করুন। / This pre-order is already marked FULFILLED but is not linked to any order — verify manually.",
      );
    }
    const order = await prisma.order.findFirst({
      where: { id: pre.convertedOrderId, deletedAt: null },
      select: {
        id: true, orderNo: true, totalPoisha: true,
        advanceRequiredPoisha: true, advanceSatisfiedAt: true,
      },
    });
    if (!order) {
      return fail(404, "ORDER_NOT_FOUND", "যুক্ত অর্ডারটি পাওয়া যায়নি। / The linked order was not found.");
    }
    const paid = await prisma.payment.aggregate({
      where: { orderId: order.id, deletedAt: null },
      _sum: { paidPoisha: true },
    });
    const paidPoisha = paid._sum.paidPoisha ?? 0;
    return {
      ok: true,
      alreadyConverted: true,
      orderId: order.id,
      orderNo: order.orderNo,
      orderTotalPoisha: order.totalPoisha,
      depositCreditedPoisha: Math.min(pre.depositPoisha, paidPoisha),
      payablePoisha: Math.max(0, order.totalPoisha - paidPoisha),
      advanceRequiredPoisha: order.advanceRequiredPoisha,
      advanceSatisfied: order.advanceSatisfiedAt !== null,
    };
  }
  if (!(PREORDER_FULFILABLE as readonly string[]).includes(pre.status)) {
    return fail(
      409,
      "PREORDER_NOT_READY",
      `প্রি-অর্ডার এখনো সরবরাহের উপযোগী নয় (বর্তমান অবস্থা ${pre.status}) — জমা পরিশোধিত (DEPOSIT_PAID) বা পণ্য প্রস্তুত (READY) হলেই অর্ডার তৈরি করা যায়। / The pre-order is not ready to fulfil (status ${pre.status}) — it must be DEPOSIT_PAID or READY first.`,
      { status: pre.status },
    );
  }

  const customer = await prisma.customer.findFirst({
    where: { id: pre.customerId, deletedAt: null },
    select: { id: true, name: true, phone: true },
  });
  if (!customer) {
    return fail(422, "CUSTOMER_NOT_FOUND", "প্রি-অর্ডারের গ্রাহক পাওয়া যায়নি। / The pre-order's customer was not found.");
  }

  let variantId = pre.variantId;
  if (!variantId) {
    const variant = await prisma.productVariant.findFirst({
      where: { productId: pre.productId },
      select: { id: true },
    });
    variantId = variant?.id ?? null;
  }
  if (!variantId) {
    return fail(422, "VARIANT_NOT_FOUND", "প্রি-অর্ডারের পণ্যের কোনো ভ্যারিয়েন্ট পাওয়া যায়নি। / No variant found for the pre-ordered product.");
  }

  const address =
    opts.address ?? (await resolveCustomerAddress(customer.id, customer.phone));
  if (!address) {
    return fail(422, "ADDRESS_REQUIRED", ADDRESS_REQUIRED_MESSAGE);
  }

  // Price snapshot from the row itself (see header) — manual-create
  // records any difference from today's catalog on the order note.
  const unitPricePoisha = pre.quantity > 0 ? Math.floor(pre.totalPoisha / pre.quantity) : 0;
  const depositPoisha = pre.depositPoisha;

  const created = await createManualOrder(
    {
      phone: customer.phone,
      customerName: customer.name,
      address,
      items: [{ variantId, quantity: pre.quantity, unitPricePoisha }],
      paymentMethod: "cod",
      shippingMethod: shippingForDistrict(address.district, opts.shippingMethod),
      // The deposit IS the advance requirement on this order — passed
      // explicitly because createManualOrder computes no preorder
      // candidate of its own (the public route does). The credit
      // Payment below then satisfies exactly this amount, once.
      // advanceLinkPolicy "suppress" (doc 18 F3): the credit lands
      // immediately after create, so NO payment link is issued — a
      // live link would let the customer pay this deposit twice.
      ...(depositPoisha > 0
        ? { advanceRequiredPoisha: depositPoisha, advanceLinkPolicy: "suppress" as const }
        : {}),
      source: "preorder",
      internalNote: `প্রি-অর্ডার ${pre.id} থেকে সরবরাহ — আগাম জমা ${depositPoisha} পয়সা এই অর্ডারে ক্রেডিট হিসেবে ধরা হবে; বাকি ডেলিভারিতে পরিশোধ্য। / Fulfilment of pre-order ${pre.id} — the ${depositPoisha} poisha deposit already paid is credited to this order; the balance is payable on delivery.`,
      idempotencyKey: conversionIdempotencyKey("preorder", pre.id),
    },
    actor,
  );
  if (!created.ok) {
    return fail(created.httpStatus, created.code, created.message, created.details);
  }

  // ---- Apply the already-paid deposit as a credit Payment (anchor-
  // deduped, exchange-credit pattern), then run the money funnel.
  const creditTxId = `preorder-deposit:${pre.id}`;
  const orderRow = await prisma.order.findFirst({
    where: { id: created.orderId },
    select: { totalPoisha: true },
  });
  const orderTotalPoisha = orderRow?.totalPoisha ?? pre.totalPoisha;
  const creditApplied = Math.min(depositPoisha, orderTotalPoisha);
  if (creditApplied > 0) {
    const existingCredit = await prisma.payment.findFirst({
      where: { orderId: created.orderId, gatewayTransactionId: creditTxId, deletedAt: null },
      select: { id: true },
    });
    if (existingCredit === null) {
      await prisma.payment.create({
        data: {
          orderId: created.orderId,
          method: "COD",
          amountPoisha: creditApplied,
          paidPoisha: creditApplied,
          status: "PAID",
          gatewayTransactionId: creditTxId,
        },
      });
      await markOrderPayment(created.orderId, {
        source: "preorder_deposit",
        reference: pre.id,
      });
      await addOrderTimelineNote(
        created.orderId,
        `প্রি-অর্ডার জমা প্রয়োগ হয়েছে: প্রি-অর্ডার ${pre.id} থেকে আগাম দেওয়া ${creditApplied} পয়সা এই অর্ডারে জমা ধরা হয়েছে [${creditTxId}] / Preorder deposit applied: ${creditApplied} poisha already paid on pre-order ${pre.id} credited to this order [${creditTxId}].`,
      );
    }
  }

  // ---- Mark FULFILLED + link, guarded so a race can't double-mark.
  await prisma.preOrder.updateMany({
    where: { id: pre.id, status: { in: [...PREORDER_FULFILABLE] } },
    data: { status: "FULFILLED", convertedOrderId: created.orderId },
  });

  const finalOrder = await prisma.order.findFirst({
    where: { id: created.orderId },
    select: {
      totalPoisha: true, advanceRequiredPoisha: true, advanceSatisfiedAt: true,
    },
  });
  const paid = await prisma.payment.aggregate({
    where: { orderId: created.orderId, deletedAt: null },
    _sum: { paidPoisha: true },
  });
  const paidPoisha = paid._sum.paidPoisha ?? 0;

  await writeAudit({
    actorId: actor.id,
    action: "preorders.fulfil",
    entityType: "PreOrder",
    entityId: pre.id,
    beforeJson: { status: pre.status },
    afterJson: {
      status: "FULFILLED",
      orderId: created.orderId,
      orderNo: created.orderNo,
      depositCreditedPoisha: creditApplied,
      orderTotalPoisha,
      replayed: created.replayed,
    },
  });

  return {
    ok: true,
    alreadyConverted: created.replayed,
    orderId: created.orderId,
    orderNo: created.orderNo,
    orderTotalPoisha,
    depositCreditedPoisha: creditApplied,
    payablePoisha: Math.max(0, orderTotalPoisha - paidPoisha),
    advanceRequiredPoisha: finalOrder?.advanceRequiredPoisha ?? 0,
    advanceSatisfied: finalOrder?.advanceSatisfiedAt != null,
  };
}
