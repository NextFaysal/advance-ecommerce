import { NextResponse } from "next/server";
import { applyCoupon, applyCouponSchema } from "@/marketing/service";
import { findCouponByCodeDb } from "@/marketing/repository";
import { guardError, requireAdmin } from "@/reports/guard";

// POST /api/v1/admin/coupons/apply — preview/apply a coupon against a cart.
// RBAC: marketing.coupon (admin preview). The record comes from the DB
// (Coupon + CouponUsage aggregates, src/marketing/repository.ts) and is
// evaluated with the same applyCoupon() the public checkout uses;
// client totals are never trusted.
export async function POST(req: Request) {
  const guard = await requireAdmin("marketing.coupon");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = applyCouponSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Invalid apply request.", details: parsed.error.issues } }, { status: 400 });
  try {
    const coupon = await findCouponByCodeDb(parsed.data.code);
    if (!coupon) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Coupon not found." } }, { status: 404 });
    const result = applyCoupon(coupon, parsed.data);
    return NextResponse.json({ data: result, meta: { persistence: "database" } });
  } catch {
    return NextResponse.json({ error: { code: "DB_NOT_READY", message: "Coupons need a working database." } }, { status: 503 });
  }
}
