/**
 * Referral — pure logic (Agent 36).
 *
 * Code generation is deterministic from a seed (customer id / phone) so a
 * customer's code is stable. Codes use an alphabet without look-alike
 * characters (no 0/O/1/I/L) and render as REF-XXXX-XXXX.
 *
 * Rewards are points (see points.ts) and are granted ONLY when the
 * referee's FIRST order reaches DELIVERED: PENDING -> QUALIFIED ->
 * REWARDED. Invalid signups are REJECTED with a typed reason.
 */
import { createHash } from "node:crypto";
import {
  DEFAULT_LOYALTY_CONFIG,
  type LoyaltyConfig,
  type Referral,
  type ReferralStatus,
  type ReferralValidationError,
} from "./types";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

/** Deterministic readable referral code from any stable seed string. */
export function generateReferralCode(seed: string): string {
  const digest = createHash("sha256").update(`referral:${seed}`).digest();
  let body = "";
  for (let i = 0; i < 8; i += 1) {
    body += CODE_ALPHABET[digest[i] % CODE_ALPHABET.length];
  }
  return `REF-${body.slice(0, 4)}-${body.slice(4)}`;
}

/** Public referral link shape (storefront origin is configuration, not code). */
export function buildReferralLink(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/?ref=${encodeURIComponent(code)}`;
}

export interface ReferralSignupInput {
  referrerCustomerId: string;
  referrerPhone: string;
  refereeCustomerId: string;
  refereePhone: string;
  /** All referrals already recorded for this referee (any referrer). */
  existingForReferee: readonly Referral[];
}

export type ReferralValidation =
  | { ok: true }
  | { ok: false; code: ReferralValidationError; message: string };

/** Self-referral and duplicate prevention. Phones are compared normalized. */
export function validateReferralSignup(input: ReferralSignupInput): ReferralValidation {
  if (input.referrerCustomerId === input.refereeCustomerId) {
    return { ok: false, code: "SELF_REFERRAL", message: "A customer cannot refer themselves." };
  }
  if (input.referrerPhone === input.refereePhone) {
    return { ok: false, code: "SAME_PHONE", message: "Referrer and referee share a phone number." };
  }
  const active = input.existingForReferee.some((r) => r.status === "PENDING" || r.status === "QUALIFIED" || r.status === "REWARDED");
  if (active) {
    return { ok: false, code: "DUPLICATE_REFEREE", message: "This customer was already referred." };
  }
  return { ok: true };
}

export function createReferral(input: {
  id: string;
  referrerCustomerId: string;
  refereeCustomerId: string;
  refereeSeed: string;
  nowIso: string;
}): Referral {
  return {
    id: input.id,
    referrerCustomerId: input.referrerCustomerId,
    refereeCustomerId: input.refereeCustomerId,
    code: generateReferralCode(input.refereeSeed),
    status: "PENDING",
    qualifyingOrderId: null,
    createdAt: input.nowIso,
    rewardedAt: null,
  };
}

const REFERRAL_TRANSITIONS: Record<ReferralStatus, readonly ReferralStatus[]> = {
  PENDING: ["QUALIFIED", "REJECTED"],
  QUALIFIED: ["REWARDED", "REJECTED"],
  REWARDED: [],
  REJECTED: [],
};

export function transitionReferral(referral: Referral, next: ReferralStatus): { ok: boolean; message: string } {
  if (!REFERRAL_TRANSITIONS[referral.status].includes(next)) {
    return { ok: false, message: `Referral cannot move ${referral.status} -> ${next}.` };
  }
  return { ok: true, message: "ok" };
}

/**
 * Qualify a referral from an order event. Only the referee's FIRST order
 * and only when it is DELIVERED. Returns the point rewards to append to
 * each side's ledger (the caller builds the EARN/ADJUST entries).
 */
export function qualifyReferral(input: {
  referral: Referral;
  orderId: string;
  orderStatus: string;
  isRefereeFirstOrder: boolean;
  nowIso: string;
  config?: LoyaltyConfig;
}): { referral: Referral; referrerRewardPoints: number; refereeRewardPoints: number } | null {
  const config = input.config ?? DEFAULT_LOYALTY_CONFIG;
  if (input.referral.status !== "PENDING") return null;
  if (!input.isRefereeFirstOrder || input.orderStatus !== "DELIVERED") return null;
  const rewarded: Referral = {
    ...input.referral,
    status: "REWARDED",
    qualifyingOrderId: input.orderId,
    rewardedAt: input.nowIso,
  };
  return {
    referral: rewarded,
    referrerRewardPoints: config.referrerRewardPoints,
    refereeRewardPoints: config.refereeRewardPoints,
  };
}
