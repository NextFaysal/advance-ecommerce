// B2B pricing, quotation flow, credit and approval logic — Agent 16. Pure.
import type {
  B2bCustomer, CreditCheck, Quotation, QuotationStatus, WholesalePriceList,
} from "./types";

/** Unit price for a quantity from a tier list: the highest tier whose
 *  minQty the quantity reaches. qty below the first tier uses retail. */
export function wholesaleUnitPricePoisha(list: WholesalePriceList, qty: number): number {
  let price = list.retailPricePoisha;
  for (const tier of list.tiers) {
    if (qty >= tier.minQty) price = tier.unitPricePoisha;
  }
  return price;
}

/** Validate a tier list: ascending minQty (>=1), prices non-increasing and
 *  never above retail. Returns all problems, not just the first. */
export function validatePriceTiers(list: WholesalePriceList): string[] {
  const problems: string[] = [];
  let prevQty = 0;
  let prevPrice = list.retailPricePoisha;
  for (const tier of list.tiers) {
    if (tier.minQty < 1) problems.push(`Tier minQty must be >= 1 (got ${tier.minQty}).`);
    if (tier.minQty <= prevQty) problems.push(`Tier minQty must be strictly ascending (got ${tier.minQty} after ${prevQty}).`);
    if (tier.unitPricePoisha < 0) problems.push("Tier price cannot be negative.");
    if (tier.unitPricePoisha > prevPrice) problems.push(`Tier price ${tier.unitPricePoisha} exceeds the previous price ${prevPrice}.`);
    prevQty = tier.minQty;
    prevPrice = tier.unitPricePoisha;
  }
  return problems;
}

export function quotationTotalPoisha(lines: Quotation["lines"]): number {
  return lines.reduce((s, l) => s + l.unitPricePoisha * l.quantity, 0);
}

const QUOTATION_TRANSITIONS: Record<QuotationStatus, readonly QuotationStatus[]> = {
  DRAFT: ["SENT", "EXPIRED"],
  SENT: ["ACCEPTED", "REJECTED", "EXPIRED"],
  ACCEPTED: ["CONVERTED"],
  REJECTED: [],
  EXPIRED: [],
  CONVERTED: [],
};

export function quotationTransition(from: QuotationStatus, to: QuotationStatus): boolean {
  return QUOTATION_TRANSITIONS[from].includes(to);
}

/** A quotation past validUntil (and not yet accepted/converted) reads as EXPIRED. */
export function effectiveQuotationStatus(q: Quotation, todayIso: string): QuotationStatus {
  if ((q.status === "DRAFT" || q.status === "SENT") && q.validUntil < todayIso) return "EXPIRED";
  return q.status;
}

/**
 * Credit check for a new B2B order on account. Blocked when: customer not
 * APPROVED, any invoice overdue, or the order would exceed the credit limit.
 * availablePoisha is never negative in the report.
 */
export function checkCredit(customer: B2bCustomer, orderTotalPoisha: number, todayIso: string): CreditCheck {
  const reasons: string[] = [];
  const overdue = Boolean(customer.oldestDueDate && customer.oldestDueDate < todayIso && customer.outstandingPoisha > 0);
  if (customer.approvalStatus !== "APPROVED") reasons.push(`Customer is ${customer.approvalStatus}, not APPROVED.`);
  if (overdue) reasons.push("Customer has overdue dues; new credit orders are blocked until cleared.");
  const availablePoisha = Math.max(0, customer.creditLimitPoisha - customer.outstandingPoisha);
  if (orderTotalPoisha > availablePoisha) {
    reasons.push(`Order total ${orderTotalPoisha} exceeds available credit ${availablePoisha}.`);
  }
  return { allowed: reasons.length === 0, availablePoisha, overdue, reasons };
}

/** Record a payment against outstanding dues. Overpayment is rejected. */
export function applyDuePayment(
  customer: B2bCustomer, amountPoisha: number,
): { ok: true; customer: B2bCustomer } | { ok: false; message: string } {
  if (!Number.isInteger(amountPoisha) || amountPoisha <= 0) {
    return { ok: false, message: "Payment must be a positive integer poisha." };
  }
  if (amountPoisha > customer.outstandingPoisha) {
    return { ok: false, message: "Payment exceeds the outstanding due." };
  }
  const outstandingPoisha = customer.outstandingPoisha - amountPoisha;
  return {
    ok: true,
    customer: {
      ...customer,
      outstandingPoisha,
      oldestDueDate: outstandingPoisha === 0 ? undefined : customer.oldestDueDate,
    },
  };
}

const APPROVAL_TRANSITIONS: Record<B2bCustomer["approvalStatus"], readonly B2bCustomer["approvalStatus"][]> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: ["SUSPENDED"],
  REJECTED: ["PENDING"], // re-application
  SUSPENDED: ["APPROVED", "REJECTED"],
};

export function approvalTransition(
  from: B2bCustomer["approvalStatus"], to: B2bCustomer["approvalStatus"],
): boolean {
  return APPROVAL_TRANSITIONS[from].includes(to);
}
