import { NextResponse } from "next/server";
import { applyCoupon, applyCouponSchema, couponStoreInMemory as couponStore } from "@/marketing/service";
import { guardError, requireAdmin } from "@/reports/guard";

// POST /api/v1/admin/coupons/apply — preview/apply a coupon against a cart.
// RBAC: marketing.coupon (admin preview). The public checkout must call the
// same applyCoupon() server-side; client totals are never trusted.
export async function POST(req: Request) {
  const guard = await requireAdmin("marketing.coupon");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = applyCouponSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Invalid apply request.", details: parsed.error.issues } }, { status: 400 });
  const coupon = couponStore.find((c) => c.code === parsed.data.code.toUpperCase());
  if (!coupon) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Coupon not found." } }, { status: 404 });
  const result = applyCoupon(coupon, parsed.data);
  return NextResponse.json({ data: result, meta: { persistence: "in-memory-demo" } });
}
