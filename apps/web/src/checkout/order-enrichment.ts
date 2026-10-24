/**
 * Order enrichment — Agent 59: real coupon + real fraud scoring for the
 * public order-create route (app/api/v1/public/orders/route.ts).
 *
 * COUPON — the discount is evaluated with the REAL applyCoupon() from
 * src/marketing/service and fed into computePricing() at the coupon stage
 * of the pipeline (subtotal -> item discounts -> coupon -> shipping ->
 * COD fee -> tax -> total), never subtracted after the fact.
 * Coupon records are looked up in this order (no new copy is created):
 *   1. couponStoreInMemory — the shared in-memory store the coupons API
 *      (app/api/v1/admin/coupons) reads and writes.
 *   2. DEMO_COUPONS — the existing demo records in src/cart/components/
 *      resolve.ts that mirror the DB seed (WELCOME10, SAMPLE-FIXED200),
 *      used because the shared store starts empty in demo mode.
 * An ineligible or unknown code never fails the order: the outcome is
 * "rejected" with the Bangla + English reason and a 0 discount.
 *
 * FRAUD — assembles a FraudScoreInput ONLY from facts honestly available
 * at create time and scores it with the REAL scoreFraud() from src/fraud:
 *   - normalized phone, payment method, grand total, item keys: the order
 *     being placed.
 *   - shipping address: the checkout form address.
 *   - recentOrders / accountAddress / returnHistory: derived from the
 *     caller's prior orders in the in-memory order store (same phone).
 *     accountAddress is the most recent prior order's address — the
 *     customer's previous address on file; absent when there is none.
 *   - lists: demoFraudListStore snapshot (src/fraud/lists) — the demo
 *     blacklist/whitelist the fraud-rules API routes manage.
 *   - courierHistory is NOT supplied: no courier outcome data exists at
 *     checkout time, so the signal stays absent rather than invented.
 * The assessment's per-signal details are internal (admin fraud UI);
 * nothing here returns them to the public caller.
 */
import { COUPON_REASON_BN, findDemoCoupon } from "@/cart/components/resolve";
import { demoFraudListStore } from "@/fraud/lists";
import type { FraudAssessment, FraudScoreInput, RecentOrderRef } from "@/fraud/types";
import {
  applyCoupon,
  couponStoreInMemory,
  type CouponRecord,
} from "@/marketing/service";
import type { RiskLevel } from "@/orders/customer";
import type { Order } from "@/orders/types";
import type { SuggestedAction } from "@/fraud/types";

/* ------------------------------------------------------------------ */
/* Enriched order record                                               */
/* ------------------------------------------------------------------ */

export type CouponOutcomeStatus = "applied" | "rejected" | "none";

/** Order as stored/returned by the public create route, with the real
 *  coupon outcome and fraud assessment fields added by this wiring. */
export interface EnrichedOrder extends Order {
  /** Fraud band from the assessment: Low <40, Medium 40-69, High >=70. */
  riskBand: RiskLevel;
  /** Suggested action enforced at create: auto_confirm / manual_review /
   *  require_advance (block never reaches storage — it is a 422). */
  fraudAction: SuggestedAction;
  /** True when fraudAction is require_advance: an advance payment is due. */
  advanceRequired: boolean;
  /** True when the fraud assessment requires an OTP challenge (>=70). */
  requiresOtp: boolean;
  /** Uppercase code the customer submitted, or null when none was sent. */
  couponCode: string | null;
  couponStatus: CouponOutcomeStatus;
  /** Discount actually applied inside the pricing pipeline, poisha. */
  couponDiscountPoisha: number;
  /** Rejection reason (Bangla / English) when couponStatus is rejected. */
  couponReasonBn: string | null;
  couponReasonEn: string | null;
}

/* ------------------------------------------------------------------ */
/* Coupon evaluation                                                   */
/* ------------------------------------------------------------------ */

const COUPON_REASON_EN: Record<string, string> = {
  coupon_inactive: "This coupon is not active.",
  coupon_not_started: "This coupon has not started yet.",
  coupon_expired: "This coupon has expired.",
  min_cart_not_met: "The minimum cart value for this coupon is not met.",
  usage_limit_reached: "This coupon's usage limit has been reached.",
  per_user_limit_reached:
    "You have already used this coupon the maximum number of times.",
  not_first_order: "This coupon is only for first orders.",
  not_stackable: "This coupon cannot be combined with another coupon.",
  not_found: "Coupon code not found.",
};

export interface CouponOutcome {
  status: CouponOutcomeStatus;
  code: string | null;
  /** Discount for the pricing pipeline's coupon stage, integer poisha. */
  discountPoisha: number;
  /** Shipping to feed the pipeline: a free-shipping coupon zeroes it. */
  shippingPoisha: number;
  reasonBn: string | null;
  reasonEn: string | null;
  /** Internal: the matched record, so the caller can record usage after
   *  the order is actually created. Never serialize this to the client. */
  record: CouponRecord | null;
}

function rejectedOutcome(
  code: string,
  shippingPoisha: number,
  reasonCode: string,
  record: CouponRecord | null,
): CouponOutcome {
  return {
    status: "rejected",
    code,
    discountPoisha: 0,
    shippingPoisha,
    reasonBn: COUPON_REASON_BN[reasonCode] ?? "কুপনটি ব্যবহার করা যাচ্ছে না।",
    reasonEn: COUPON_REASON_EN[reasonCode] ?? "This coupon cannot be applied.",
    record,
  };
}

/** Finds the coupon record for a submitted code: shared coupons-API store
 *  first, then the existing seed-mirroring demo records. */
export function findOrderCoupon(code: string): CouponRecord | null {
  const normalized = code.trim().toUpperCase();
  if (normalized === "") return null;
  return (
    couponStoreInMemory.find((c) => c.code === normalized) ??
    findDemoCoupon(normalized)
  );
}

export function evaluateOrderCoupon(args: {
  code: string | undefined;
  subtotalPoisha: number;
  shippingPoisha: number;
  /** Per-user usage key — the normalized customer phone at guest checkout. */
  userKey: string;
  isFirstOrder: boolean;
}): CouponOutcome {
  const code = args.code?.trim().toUpperCase() ?? "";
  if (code === "") {
    return {
      status: "none",
      code: null,
      discountPoisha: 0,
      shippingPoisha: args.shippingPoisha,
      reasonBn: null,
      reasonEn: null,
      record: null,
    };
  }
  const record = findOrderCoupon(code);
  if (!record) {
    return rejectedOutcome(code, args.shippingPoisha, "not_found", null);
  }
  const result = applyCoupon(record, {
    code,
    subtotalPoisha: args.subtotalPoisha,
    shippingPoisha: args.shippingPoisha,
    userId: args.userKey,
    isFirstOrder: args.isFirstOrder,
    alreadyAppliedCodes: [],
  });
  if (!result.eligible) {
    return rejectedOutcome(
      code,
      args.shippingPoisha,
      result.reason ?? "not_found",
      record,
    );
  }
  return {
    status: "applied",
    code,
    discountPoisha: result.discountPoisha,
    shippingPoisha: result.shippingPoisha,
    reasonBn: null,
    reasonEn: null,
    record,
  };
}

/** Records one use of an applied coupon (in-memory demo bookkeeping on the
 *  shared/demo record). Call ONLY after the order is created — never on a
 *  fraud block and never on an idempotent replay. */
export function recordCouponUse(record: CouponRecord, userKey: string): void {
  record.usedCount += 1;
  record.usedByUser[userKey] = (record.usedByUser[userKey] ?? 0) + 1;
}

/* ------------------------------------------------------------------ */
/* Fraud input assembly                                                */
/* ------------------------------------------------------------------ */

/**
 * Builds the FraudScoreInput for an order being created. `priorOrders` is
 * the in-memory order store BEFORE the new order is pushed, so the order
 * never scores against itself.
 */
export function assembleFraudInput(args: {
  phone: string;
  address: { division: string; district: string; upazila: string };
  paymentMethod: string;
  totalPoisha: number;
  itemKeys: string[];
  priorOrders: readonly Order[];
  now: string;
}): FraudScoreInput {
  const own = args.priorOrders.filter((o) => o.customerPhone === args.phone);
  const newestFirst = [...own].reverse();
  const recentOrders: RecentOrderRef[] = newestFirst.map((o) => ({
    id: o.id,
    itemKeys: o.items.map((i) => i.variantId),
    createdAt: o.createdAt,
    status: o.status,
  }));
  const previous = newestFirst[0];
  return {
    phone: args.phone,
    shippingAddress: {
      division: args.address.division,
      district: args.address.district,
      upazila: args.address.upazila,
    },
    // The customer's previous address on file = their most recent prior
    // order's address. Absent for a first-time phone (absence is not a
    // signal, per the scorer's contract).
    accountAddress: previous
      ? {
          division: previous.address.division,
          district: previous.address.district,
          upazila: previous.address.upazila,
        }
      : undefined,
    paymentMethod: args.paymentMethod,
    totalPoisha: args.totalPoisha,
    itemKeys: args.itemKeys,
    recentOrders,
    returnHistory: {
      totalOrders: own.length,
      returnedOrders: own.filter((o) => o.status === "RETURNED").length,
    },
    lists: demoFraudListStore.snapshot(),
    now: args.now,
  };
}

/** Enforcement view of an assessment for the create route. Signal details
 *  stay internal; only these outcomes cross to the public response. */
export interface FraudEnforcement {
  blocked: boolean;
  advanceRequired: boolean;
  requiresOtp: boolean;
}

export function fraudEnforcement(assessment: FraudAssessment): FraudEnforcement {
  return {
    blocked: assessment.suggestedAction === "block",
    advanceRequired: assessment.suggestedAction === "require_advance",
    requiresOtp: assessment.requiresOtp,
  };
}
