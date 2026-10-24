/**
 * Fraud scoring — Agent 13, Step 43 (A2). Pure and unit-testable:
 * deterministic for a given input, no DB, no Date.now() (now is injected),
 * no provider calls. Every signal is reported with its points so the admin
 * UI can explain WHY an order scored what it scored.
 *
 * Score 0-100, higher = riskier. Bands reuse orders/customer riskLevel()
 * (Low <40, Medium 40-69, High >=70) so badges agree across the dashboard.
 *
 * Signal table (points):
 *  blacklist_hit        +90, and the total is floored at 90 — suggested
 *                       action is always "block".
 *  duplicate_order      +35 for 1 duplicate in the window, +45 for 2+
 *                       (same phone, overlapping item, not cancelled).
 *  courier_success_rate needs >= 3 bookings: rate < 50% +30, 50-69% +15.
 *  high_cod_amount      COD only: total >= ৳10,000 (1000000 poisha) +20,
 *                       >= ৳5,000 (500000 poisha) +10.
 *  address_mismatch     shipping district != account district +15.
 *  return_history       needs >= 3 orders: returns > 30% +20, > 15% +10.
 *  whitelist            -30 when whitelisted and NOT blacklisted
 *                       (blacklist always wins over whitelist).
 *
 * Test cases:
 *  - clean first order, prepaid, ৳1,200 -> all signals 0 -> score 0,
 *    Low, auto_confirm, requiresOtp false.
 *  - blacklisted phone, otherwise clean -> score 90, High, block, OTP true.
 *  - duplicate + COD ৳12,000 + courier rate 40% (5 bookings)
 *    -> 35 + 20 + 30 = 85, High, require_advance, OTP true.
 *  - whitelisted repeat customer with one duplicate -> 35 - 30 = 5, Low.
 */
import { maskPhone } from "../checkout/validation";
import { riskLevel } from "../orders/customer";
import { findBlacklistHit, isWhitelisted } from "./lists";
import type {
  FraudAssessment,
  FraudScoreInput,
  SignalResult,
  SuggestedAction,
} from "./types";

export const SCORE_WEIGHTS = {
  blacklistHit: 90,
  duplicateOne: 35,
  duplicateMany: 45,
  courierRateLow: 30,
  courierRateMid: 15,
  codHigh: 20,
  codMid: 10,
  codMidThresholdPoisha: 500000,
  codHighThresholdPoisha: 1000000,
  addressMismatch: 15,
  returnRateHigh: 20,
  returnRateMid: 10,
  whitelistCredit: -30,
} as const;

export const DEFAULT_DUPLICATE_WINDOW_MINUTES = 60;

/** Courier delivery success rate 0-100 for a phone, or null when there is too little history to judge (< 3 bookings). */
export function courierSuccessRate(input: { totalBookings: number; delivered: number }): number | null {
  if (input.totalBookings < 3) return null;
  return Math.round((input.delivered / input.totalBookings) * 100);
}

function duplicateSignal(input: FraudScoreInput): SignalResult {
  const windowMinutes = input.duplicateWindowMinutes ?? DEFAULT_DUPLICATE_WINDOW_MINUTES;
  const nowMs = new Date(input.now).getTime();
  const windowStart = nowMs - windowMinutes * 60 * 1000;
  const ownItems = new Set(input.itemKeys);
  const duplicates = input.recentOrders.filter((o) => {
    if (o.status === "CANCELLED") return false;
    const at = new Date(o.createdAt).getTime();
    if (at < windowStart || at > nowMs) return false;
    return o.itemKeys.some((k) => ownItems.has(k));
  });
  if (duplicates.length === 0) {
    return { key: "duplicate_order", points: 0, triggered: false, detail: `No duplicate order in the last ${windowMinutes} minutes.` };
  }
  const points = duplicates.length >= 2 ? SCORE_WEIGHTS.duplicateMany : SCORE_WEIGHTS.duplicateOne;
  return {
    key: "duplicate_order",
    points,
    triggered: true,
    detail: `${duplicates.length} recent order(s) from this phone share an item within ${windowMinutes} minutes.`,
  };
}

export function scoreFraud(input: FraudScoreInput): FraudAssessment {
  const signals: SignalResult[] = [];
  const district = input.shippingAddress.district;

  const blacklistHit = findBlacklistHit(input.lists, { phone: input.phone, district });
  signals.push(
    blacklistHit
      ? {
          key: "blacklist_hit",
          points: SCORE_WEIGHTS.blacklistHit,
          triggered: true,
          detail: `Blacklist hit (${blacklistHit.kind}): ${blacklistHit.reason}.`,
        }
      : { key: "blacklist_hit", points: 0, triggered: false, detail: "No blacklist match." },
  );

  const whitelisted = !blacklistHit && isWhitelisted(input.lists, { phone: input.phone, district });
  signals.push({
    key: "whitelist",
    points: whitelisted ? SCORE_WEIGHTS.whitelistCredit : 0,
    triggered: whitelisted,
    detail: whitelisted
      ? "Whitelisted customer — trust credit applied (blacklist would override it)."
      : "Not whitelisted.",
  });

  signals.push(duplicateSignal(input));

  if (input.courierHistory) {
    const rate = courierSuccessRate(input.courierHistory);
    if (rate === null) {
      signals.push({
        key: "courier_success_rate",
        points: 0,
        triggered: false,
        detail: `Courier history too small to judge (${input.courierHistory.totalBookings} bookings, need 3+).`,
      });
    } else {
      const points = rate < 50 ? SCORE_WEIGHTS.courierRateLow : rate < 70 ? SCORE_WEIGHTS.courierRateMid : 0;
      signals.push({
        key: "courier_success_rate",
        points,
        triggered: points > 0,
        detail: `Courier success rate for this phone is ${rate}% over ${input.courierHistory.totalBookings} bookings.`,
      });
    }
  } else {
    signals.push({
      key: "courier_success_rate",
      points: 0,
      triggered: false,
      detail: "No courier history supplied for this phone.",
    });
  }

  const isCod = input.paymentMethod === "cod";
  const codPoints = !isCod
    ? 0
    : input.totalPoisha >= SCORE_WEIGHTS.codHighThresholdPoisha
      ? SCORE_WEIGHTS.codHigh
      : input.totalPoisha >= SCORE_WEIGHTS.codMidThresholdPoisha
        ? SCORE_WEIGHTS.codMid
        : 0;
  signals.push({
    key: "high_cod_amount",
    points: codPoints,
    triggered: codPoints > 0,
    detail: isCod
      ? `COD order total is ${input.totalPoisha} poisha.`
      : "Not a COD order — amount risk does not apply.",
  });

  const mismatch =
    input.accountAddress !== undefined &&
    input.accountAddress.district.trim().toLowerCase() !== district.trim().toLowerCase();
  signals.push({
    key: "address_mismatch",
    points: mismatch ? SCORE_WEIGHTS.addressMismatch : 0,
    triggered: mismatch,
    detail: mismatch
      ? `Shipping district (${district}) differs from the account address district (${input.accountAddress?.district}).`
      : "Shipping district matches the account address (or no account address on file).",
  });

  if (input.returnHistory && input.returnHistory.totalOrders >= 3) {
    const ratio = input.returnHistory.returnedOrders / input.returnHistory.totalOrders;
    const points = ratio > 0.3 ? SCORE_WEIGHTS.returnRateHigh : ratio > 0.15 ? SCORE_WEIGHTS.returnRateMid : 0;
    signals.push({
      key: "return_history",
      points,
      triggered: points > 0,
      detail: `Return rate is ${Math.round(ratio * 100)}% over ${input.returnHistory.totalOrders} orders.`,
    });
  } else {
    signals.push({
      key: "return_history",
      points: 0,
      triggered: false,
      detail: "Return history too small to judge (need 3+ orders) or not supplied.",
    });
  }

  const raw = signals.reduce((sum, s) => sum + s.points, 0);
  const floored = blacklistHit ? Math.max(raw, SCORE_WEIGHTS.blacklistHit) : raw;
  const score = Math.min(100, Math.max(0, floored));
  const level = riskLevel(score);

  const suggestedAction: SuggestedAction = blacklistHit
    ? "block"
    : score >= 90
      ? "block"
      : score >= 70
        ? "require_advance"
        : score >= 40
          ? "manual_review"
          : "auto_confirm";

  return {
    score,
    level,
    suggestedAction,
    // High risk must verify by OTP before confirm; a blacklist block also
    // flags OTP so a staff override flow can challenge the caller first.
    requiresOtp: score >= 70,
    signals,
    phoneMasked: maskPhone(input.phone),
    assessedAt: input.now,
  };
}
