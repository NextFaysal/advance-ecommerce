// Exchange + merge + pre-order logic — Agent 16, Step 48 (A9). Pure functions.
import { SHIPPED_OR_BEYOND, type ExchangeComputation, type ExchangeRequest,
  type MergeCandidate, type MergeValidation, type PreOrder } from "./types";

/** Price difference for an exchange, computed from purchase-time snapshot prices. */
export function computeExchange(req: ExchangeRequest): ExchangeComputation {
  const returnedValuePoisha = req.returnedItem.unitPricePoisha * req.returnedQty;
  const replacementValuePoisha = req.replacementItem.unitPricePoisha * req.replacementQty;
  const differencePoisha = replacementValuePoisha - returnedValuePoisha;
  return {
    returnedValuePoisha,
    replacementValuePoisha,
    differencePoisha,
    direction: differencePoisha > 0 ? "CUSTOMER_OWES" : differencePoisha < 0 ? "STORE_REFUNDS" : "EVEN",
  };
}

function sameAddress(a: MergeCandidate["address"], b: MergeCandidate["address"]): boolean {
  const norm = (s: string | undefined): string => (s ?? "").trim().toLowerCase();
  return (
    norm(a.division) === norm(b.division) &&
    norm(a.district) === norm(b.district) &&
    norm(a.upazila) === norm(b.upazila) &&
    norm(a.addressLine) === norm(b.addressLine)
  );
}

/**
 * Two orders may merge only when: same customer (normalized phone), same
 * delivery address, and neither has shipped yet. Every failure reason is
 * returned so staff see all problems at once, not one at a time.
 */
export function validateOrderMerge(a: MergeCandidate, b: MergeCandidate): MergeValidation {
  const reasons: string[] = [];
  if (a.id === b.id) reasons.push("Cannot merge an order with itself.");
  if (a.customerPhone !== b.customerPhone) reasons.push("Customers differ (phone mismatch).");
  if (!sameAddress(a.address, b.address)) reasons.push("Delivery addresses differ.");
  if (SHIPPED_OR_BEYOND.includes(a.status)) reasons.push(`Order ${a.orderNo} has already shipped (status ${a.status}).`);
  if (SHIPPED_OR_BEYOND.includes(b.status)) reasons.push(`Order ${b.orderNo} has already shipped (status ${b.status}).`);
  if (a.status === "CANCELLED" || b.status === "CANCELLED") reasons.push("A cancelled order cannot be merged.");
  return {
    ok: reasons.length === 0,
    reasons,
    mergedTotalPoisha: reasons.length === 0 ? a.totalPoisha + b.totalPoisha : null,
  };
}

/** Remaining balance on a pre-order after its deposit. Deposit can never exceed the total. */
export function preOrderDuePoisha(pre: Pick<PreOrder, "unitPricePoisha" | "quantity" | "depositPoisha">): number {
  return pre.unitPricePoisha * pre.quantity - pre.depositPoisha;
}

export function validatePreOrderDeposit(totalPoisha: number, depositPoisha: number): string | null {
  if (depositPoisha < 0) return "Deposit cannot be negative.";
  if (depositPoisha > totalPoisha) return "Deposit cannot exceed the pre-order total.";
  return null;
}

export function applyPreOrderFulfilment(
  pre: PreOrder, qty: number,
): { ok: true; preOrder: PreOrder } | { ok: false; message: string } {
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, message: "Fulfilment qty must be a positive integer." };
  if (pre.status === "CANCELLED" || pre.status === "FULFILLED") {
    return { ok: false, message: `Pre-order is ${pre.status} and cannot be fulfilled.` };
  }
  if (pre.fulfilledQty + qty > pre.quantity) return { ok: false, message: "Cannot fulfil more than the pre-ordered quantity." };
  const fulfilledQty = pre.fulfilledQty + qty;
  return {
    ok: true,
    preOrder: {
      ...pre, fulfilledQty,
      status: fulfilledQty === pre.quantity ? "FULFILLED" : "PARTIALLY_FULFILLED",
    },
  };
}
