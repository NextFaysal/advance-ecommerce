// Coupon rule types — Agent 5, Step 25 (types + validation only).
// Money is integer poisha. Discount must never exceed the amount it applies to.
import { z } from "zod";

export type CouponType = "percent" | "fixed" | "free_shipping" | "first_order";

export const couponSchema = z.object({
  code: z.string().min(1).transform((s) => s.toUpperCase()),
  type: z.enum(["percent", "fixed", "free_shipping", "first_order"]),
  /** For percent: 1-100. For fixed/free_shipping/first_order: ignored, use valuePoisha. */
  valuePercent: z.number().int().min(1).max(100).nullable(),
  /** Integer poisha discount (fixed) or cap (percent). */
  valuePoisha: z.number().int().min(0).nullable(),
  minCartPoisha: z.number().int().min(0).nullable(),
  maxDiscountPoisha: z.number().int().min(0).nullable(),
  usageLimit: z.number().int().positive().nullable(),
  perUserLimit: z.number().int().positive().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  stackable: z.boolean(),
  isActive: z.boolean(),
});

export type CouponInput = z.infer<typeof couponSchema>;

export interface CouponEvaluation {
  couponCode: string;
  /** Integer poisha discount. 0 when ineligible. */
  discountPoisha: number;
  eligible: boolean;
  reason: string | null;
}

/** Pure discount calculation: percent is capped, fixed is capped at the subtotal. */
export function calculateDiscount(
  coupon: Pick<CouponInput, "type" | "valuePercent" | "valuePoisha" | "maxDiscountPoisha">,
  subtotalPoisha: number,
): number {
  if (subtotalPoisha <= 0) return 0;
  if (coupon.type === "percent") {
    const raw = Math.floor((subtotalPoisha * (coupon.valuePercent ?? 0)) / 100);
    const capped = coupon.maxDiscountPoisha !== null ? Math.min(raw, coupon.maxDiscountPoisha) : raw;
    return Math.min(capped, subtotalPoisha);
  }
  if (coupon.type === "fixed") {
    return Math.min(coupon.valuePoisha ?? 0, subtotalPoisha);
  }
  return 0; // free_shipping / first_order are handled by the shipping/first-order rules in Step 25
}
