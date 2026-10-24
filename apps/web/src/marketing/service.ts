// Marketing service — Agent 10, Steps 25-26.
// Coupon + campaign logic in integer poisha, on top of Agent 5 types.
// No sends happen here: campaign creation only computes cost and status;
// actual SMS/email dispatch is a BullMQ job owner (Step 26), not this file.
import { z } from "zod";
import { calculateDiscount, couponSchema, type CouponInput } from "./coupon";

export interface CouponRecord extends CouponInput {
  id: string;
  usedCount: number;
  usedByUser: Record<string, number>;
}
export const applyCouponSchema = z.object({
  code: z.string().min(1),
  subtotalPoisha: z.number().int().min(0),
  shippingPoisha: z.number().int().min(0).default(0),
  userId: z.string().optional(),
  isFirstOrder: z.boolean().default(false),
  alreadyAppliedCodes: z.array(z.string()).default([]),
});
export type ApplyCouponInput = z.infer<typeof applyCouponSchema>;

export function applyCoupon(coupon: CouponRecord, input: ApplyCouponInput): { discountPoisha: number; shippingPoisha: number; eligible: boolean; reason: string | null } {
  const now = new Date().toISOString();
  if (!coupon.isActive) return { discountPoisha: 0, shippingPoisha: input.shippingPoisha, eligible: false, reason: "coupon_inactive" };
  if (coupon.startsAt && now < coupon.startsAt) return { discountPoisha: 0, shippingPoisha: input.shippingPoisha, eligible: false, reason: "coupon_not_started" };
  if (coupon.endsAt && now > coupon.endsAt) return { discountPoisha: 0, shippingPoisha: input.shippingPoisha, eligible: false, reason: "coupon_expired" };
  if (coupon.minCartPoisha !== null && input.subtotalPoisha < coupon.minCartPoisha) return { discountPoisha: 0, shippingPoisha: input.shippingPoisha, eligible: false, reason: "min_cart_not_met" };
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) return { discountPoisha: 0, shippingPoisha: input.shippingPoisha, eligible: false, reason: "usage_limit_reached" };
  if (coupon.perUserLimit !== null && input.userId && (coupon.usedByUser[input.userId] ?? 0) >= coupon.perUserLimit) return { discountPoisha: 0, shippingPoisha: input.shippingPoisha, eligible: false, reason: "per_user_limit_reached" };
  if (coupon.type === "first_order" && !input.isFirstOrder) return { discountPoisha: 0, shippingPoisha: input.shippingPoisha, eligible: false, reason: "not_first_order" };
  // Stackable rule: a non-stackable coupon cannot combine with any other coupon.
  if (!coupon.stackable && input.alreadyAppliedCodes.length > 0) return { discountPoisha: 0, shippingPoisha: input.shippingPoisha, eligible: false, reason: "not_stackable" };
  if (coupon.type === "free_shipping") return { discountPoisha: 0, shippingPoisha: 0, eligible: true, reason: null };
  const discountPoisha = calculateDiscount(coupon, input.subtotalPoisha);
  return { discountPoisha, shippingPoisha: input.shippingPoisha, eligible: true, reason: null };
}

export function applyCoupons(coupons: CouponRecord[], input: Omit<ApplyCouponInput, "alreadyAppliedCodes">): { discountPoisha: number; shippingPoisha: number; applied: string[]; rejected: { code: string; reason: string | null }[] } {
  let discountPoisha = 0;
  let shippingPoisha = input.shippingPoisha;
  const applied: string[] = [];
  const rejected: { code: string; reason: string | null }[] = [];
  for (const c of coupons) {
    const r = applyCoupon(c, { ...input, alreadyAppliedCodes: applied });
    if (r.eligible) { discountPoisha += r.discountPoisha; shippingPoisha = r.shippingPoisha; applied.push(c.code); }
    else rejected.push({ code: c.code, reason: r.reason });
  }
  return { discountPoisha: Math.min(discountPoisha, input.subtotalPoisha), shippingPoisha, applied, rejected };
}

export const createCouponSchema = couponSchema;
export function createCouponRecord(input: CouponInput): CouponRecord {
  return { ...input, id: `cpn_${Date.now()}`, usedCount: 0, usedByUser: {} };
}
/** Shared in-memory coupon store for API routes (stub persistence, demo only). */
export const couponStoreInMemory: CouponRecord[] = [];

// Campaign cost estimate — Bangla Unicode segment note (Agent 5):
// GSM-7: 160 chars / 153 concatenated. Unicode (Bangla, emoji): 70 / 67.
// Segments are computed from the RENDERED message, never a fixed price.
export function isUnicodeMessage(text: string): boolean {
  // Bangla block U+0980-U+09FF, or any non-ASCII char, forces Unicode encoding.
  return /[^\x00-\x7F]/.test(text);
}
export function smsSegments(text: string): number {
  if (text.length === 0) return 0;
  const unicode = isUnicodeMessage(text);
  const single = unicode ? 70 : 160;
  const concat = unicode ? 67 : 153;
  return text.length <= single ? 1 : Math.ceil(text.length / concat);
}
export const createCampaignSchema = z.object({
  channel: z.enum(["sms", "email"]),
  segmentRef: z.string().min(1),
  templateKey: z.string().min(1),
  messageText: z.string().min(1).max(2000),
  recipientCount: z.number().int().min(0),
  pricePerSegmentPoisha: z.number().int().min(0).default(0),
  scheduledAt: z.string().nullable().default(null),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export function estimateCampaignCost(input: CreateCampaignInput): { segmentsPerMessage: number; costEstimatePoisha: number; isUnicode: boolean } {
  if (input.channel === "email") return { segmentsPerMessage: 0, costEstimatePoisha: 0, isUnicode: isUnicodeMessage(input.messageText) };
  const segmentsPerMessage = smsSegments(input.messageText);
  return { segmentsPerMessage, costEstimatePoisha: segmentsPerMessage * input.recipientCount * input.pricePerSegmentPoisha, isUnicode: isUnicodeMessage(input.messageText) };
}

// Abandoned-cart follow-up — stub state machine (no sends here).
export type FollowUpStatus = "pending" | "sent" | "recovered" | "expired";
export interface AbandonedFollowUp { checkoutId: string; customerPhone: string; channel: "sms" | "email"; attempt: number; status: FollowUpStatus; }
export function nextFollowUp(f: AbandonedFollowUp, outcome: "sent" | "recovered" | "expired"): AbandonedFollowUp {
  if (f.status === "recovered" || f.status === "expired") throw new Error("follow-up is terminal");
  return { ...f, attempt: outcome === "sent" ? f.attempt + 1 : f.attempt, status: outcome };
}
