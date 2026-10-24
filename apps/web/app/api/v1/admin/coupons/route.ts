import { NextResponse } from "next/server";
import { couponStoreInMemory as couponStore, createCouponRecord, createCouponSchema } from "@/marketing/service";
import { guardError, requireAdmin } from "@/reports/guard";

// Coupons — Agent 10, Step 25. RBAC: marketing.coupon.
// In-memory store (demo); DB table proposal is in Agent 5 SCHEMA-ADDITIONS.
export async function GET() {
  const guard = await requireAdmin("marketing.coupon");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  return NextResponse.json({ data: { coupons: couponStore }, meta: { persistence: "in-memory-demo" } });
}
export async function POST(req: Request) {
  const guard = await requireAdmin("marketing.coupon");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = createCouponSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Invalid coupon.", details: parsed.error.issues } }, { status: 400 });
  if (couponStore.some((c) => c.code === parsed.data.code)) {
    return NextResponse.json({ error: { code: "CODE_EXISTS", message: "Coupon code already exists." } }, { status: 409 });
  }
  const coupon = createCouponRecord(parsed.data);
  couponStore.push(coupon);
  return NextResponse.json({ data: { coupon }, meta: { persistence: "in-memory-demo" } }, { status: 201 });
}
