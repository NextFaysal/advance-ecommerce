/**
 * Advance payment engine — shared helpers (wave 21, doc 17 batch O3).
 *
 * An order may carry a persisted advance requirement (Order columns
 * advanceRequiredPoisha / advanceReason / advanceSatisfiedAt, plus the
 * OTP columns O3-2 writes). This module owns the pure pieces every
 * caller shares so the public checkout route, the admin manual-create
 * route, the transition funnel and the bulk processor can never drift:
 *
 *  - the bilingual reason labels identifying the winning rule,
 *  - the MAX picker over candidate requirements,
 *  - the CONFIRMED gate decision (advance unpaid / OTP unverified),
 *  - payment-link issuing through the EXISTING link module
 *    (src/bd/payment-link — no parallel link system), and
 *  - the read model for the admin order-detail advance panel.
 *
 * Money is integer poisha everywhere. Nothing here sends money or
 * messages: the payment link is a URL the shop shares with the
 * customer; payment itself lands through the normal payment funnels
 * and markOrderPayment stamps satisfaction.
 */
import { prisma } from "@advance-ecommerce/db";
import {
  createPaymentLink,
  paymentLinkStore,
  withEffectiveStatus,
} from "../bd/payment-link";

/* ------------------------------------------------------------------ */
/* Reason labels (bilingual; the leading key identifies the rule)      */
/* ------------------------------------------------------------------ */

export type AdvanceReasonKind = "rules" | "fraud_review" | "prepaid" | "preorder_deposit" | "staff";

export const ADVANCE_REASON_LABELS: Record<AdvanceReasonKind, string> = {
  rules:
    "rules: বড় অর্ডারের জন্য অগ্রিম পেমেন্ট প্রয়োজন / Advance payment required for a large order (orders.rules.advance_required_above_poisha)",
  fraud_review:
    "fraud_review: ঝুঁকি পর্যালোচনায় অগ্রিম পেমেন্ট প্রয়োজন / Advance payment required by fraud-risk review",
  prepaid:
    "prepaid: প্রিপেইড পেমেন্ট — সম্পূর্ণ মূল্য অগ্রিম প্রয়োজন / Prepaid payment — the full amount is required in advance",
  preorder_deposit:
    "preorder_deposit: প্রি-অর্ডার জামানত প্রয়োজন / Preorder deposit required",
  staff: "staff: কর্মীর নির্ধারিত অগ্রিম পেমেন্ট / Advance payment set by staff",
};

/** Percent-of-total advance (the rules percent / fraud band amount). */
export function percentAdvancePoisha(totalPoisha: number, percent: number): number {
  if (totalPoisha <= 0 || percent <= 0) return 0;
  return Math.min(totalPoisha, Math.round((totalPoisha * percent) / 100));
}

export interface AdvanceCandidate {
  amountPoisha: number;
  reason: string;
}

/**
 * The winning requirement: the MAX amount across every rule that
 * fired (rules threshold, fraud band, prepaid full total, preorder
 * deposits, staff-set). Ties keep the EARLIER candidate, so callers
 * order candidates by precedence. A zero/negative winner means no
 * advance is required and the reason is null.
 */
export function pickAdvanceRequirement(candidates: readonly AdvanceCandidate[]): {
  advanceRequiredPoisha: number;
  advanceReason: string | null;
} {
  let best: AdvanceCandidate = { amountPoisha: 0, reason: "" };
  for (const c of candidates) {
    if (c.amountPoisha > best.amountPoisha) best = c;
  }
  if (best.amountPoisha <= 0) return { advanceRequiredPoisha: 0, advanceReason: null };
  return { advanceRequiredPoisha: best.amountPoisha, advanceReason: best.reason };
}

/* ------------------------------------------------------------------ */
/* CONFIRMED gate                                                      */
/* ------------------------------------------------------------------ */

export type AdvanceBlockCode = "ADVANCE_NOT_PAID" | "OTP_NOT_VERIFIED";

export interface AdvanceBlock {
  code: AdvanceBlockCode;
  /** Bilingual, customer/staff-safe — names no fraud internals. */
  message: string;
}

export interface AdvanceGateState {
  advanceRequiredPoisha: number;
  advanceSatisfiedAt: Date | string | null;
  requiresOtp: boolean;
  otpVerifiedAt: Date | string | null;
}

/**
 * Why an order may not move PENDING -> CONFIRMED yet, or null when it
 * may. OTP is checked first (its refusal is the more specific one when
 * both apply); an unsatisfied advance is the ADVANCE_NOT_PAID refusal.
 * Cancellation never consults this gate.
 */
export function advanceConfirmBlock(state: AdvanceGateState): AdvanceBlock | null {
  if (state.requiresOtp && !state.otpVerifiedAt) {
    return {
      code: "OTP_NOT_VERIFIED",
      message:
        "এই অর্ডারের জন্য OTP যাচাইকরণ বাকি আছে — যাচাই সম্পূর্ণ না হলে অর্ডার নিশ্চিত করা যাবে না। / This order still needs OTP verification — it cannot be confirmed until the OTP is verified.",
    };
  }
  if (state.advanceRequiredPoisha > 0 && !state.advanceSatisfiedAt) {
    return {
      code: "ADVANCE_NOT_PAID",
      message: `এই অর্ডারের জন্য ${state.advanceRequiredPoisha} পয়সা অগ্রিম পেমেন্ট বাকি আছে — অগ্রিম পরিশোধ না হলে অর্ডার নিশ্চিত করা যাবে না। / An advance payment of ${state.advanceRequiredPoisha} poisha is still due for this order — it cannot be confirmed until the advance is paid.`,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Payment link issuing (existing module — src/bd/payment-link)        */
/* ------------------------------------------------------------------ */

/**
 * Creates + persists a payment link for exactly the advance amount
 * and returns the ONE-TIME plain token + URL (only the token's hash
 * is ever stored — see src/bd/payment-link). Returns null on any
 * failure: link issuing must never fail an order create, and a null
 * is reported honestly (amount + state only, no fake link).
 */
export async function issueAdvancePaymentLink(
  orderId: string,
  amountPoisha: number,
): Promise<{ url: string; plainToken: string } | null> {
  if (amountPoisha <= 0) return null;
  try {
    const appBaseUrl = process.env["NEXT_PUBLIC_APP_URL"];
    const created = createPaymentLink({
      orderId,
      amountPoisha,
      purpose: "advance",
      ttlMinutes: 60 * 48, // the link module's own default (48h)
      ...(appBaseUrl ? { baseUrl: appBaseUrl } : {}),
    });
    await paymentLinkStore.add(created.record);
    return { url: created.url, plainToken: created.plainToken };
  } catch (err) {
    console.error(`[orders] advance payment link failed for order ${orderId}:`, err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Read model for the admin order-detail advance panel                 */
/* ------------------------------------------------------------------ */

export interface OrderAdvanceView {
  requiredPoisha: number;
  /** The persisted bilingual winning-rule label, or null. */
  reason: string | null;
  /** Cumulative paid money: Σ Payment.paidPoisha + Σ APPROVED manual
   *  Trx — the same gross definition markOrderPayment and the refund
   *  workbench use (refunds do not reduce the advance tally). */
  paidPoisha: number;
  /** max(0, required - paid); 0 once satisfied. */
  remainingPoisha: number;
  satisfiedAt: string | null;
  requiresOtp: boolean;
  otpVerifiedAt: string | null;
  /** The newest ACTIVE link for the order, if one exists. The plain
   *  token is never stored, so an existing link can be described
   *  (amount / expiry / status) but its URL cannot be re-shown. */
  activeLink: { amountPoisha: number; expiresAt: string; status: string } | null;
}

export async function getOrderAdvanceView(idOrNo: string): Promise<OrderAdvanceView | null> {
  const order = await prisma.order.findFirst({
    where: { deletedAt: null, OR: [{ id: idOrNo }, { orderNo: idOrNo }] },
    select: {
      id: true,
      advanceRequiredPoisha: true,
      advanceReason: true,
      advanceSatisfiedAt: true,
      requiresOtp: true,
      otpVerifiedAt: true,
    },
  });
  if (!order) return null;
  const [paymentAgg, manualAgg] = await Promise.all([
    prisma.payment.aggregate({
      where: { orderId: order.id, deletedAt: null },
      _sum: { paidPoisha: true },
    }),
    prisma.manualTrxSubmission.aggregate({
      // paymentId: null — payment-linked submissions (Rocket) carry
      // their money on the Payment; see orders/repository.ts.
      where: { orderId: order.id, status: "APPROVED", paymentId: null },
      _sum: { amountPoisha: true },
    }),
  ]);
  const paidPoisha = (paymentAgg._sum.paidPoisha ?? 0) + (manualAgg._sum.amountPoisha ?? 0);
  let activeLink: OrderAdvanceView["activeLink"] = null;
  if (order.advanceRequiredPoisha > 0 && !order.advanceSatisfiedAt) {
    const links = await paymentLinkStore.listByOrder(order.id);
    const active = links
      .map((l) => withEffectiveStatus(l))
      .find((l) => l.status === "active");
    if (active) {
      activeLink = {
        amountPoisha: active.amountPoisha,
        expiresAt: active.expiresAt,
        status: active.status,
      };
    }
  }
  return {
    requiredPoisha: order.advanceRequiredPoisha,
    reason: order.advanceReason,
    paidPoisha,
    remainingPoisha: order.advanceSatisfiedAt
      ? 0
      : Math.max(0, order.advanceRequiredPoisha - paidPoisha),
    satisfiedAt: order.advanceSatisfiedAt ? order.advanceSatisfiedAt.toISOString() : null,
    requiresOtp: order.requiresOtp,
    otpVerifiedAt: order.otpVerifiedAt ? order.otpVerifiedAt.toISOString() : null,
    activeLink,
  };
}
