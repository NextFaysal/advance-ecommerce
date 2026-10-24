import { NextResponse } from "next/server";
import { createCouponSchema } from "@/marketing/service";
import { createCouponDb, findCouponByCodeDb, listCouponsDb } from "@/marketing/repository";
import { guardError, requireAdmin } from "@/reports/guard";

// Coupons — Agent 10, Step 25. RBAC: marketing.coupon.
// DB-backed (Coupon + CouponUsage tables, src/marketing/repository.ts):
// definitions persist, usage counts are aggregated from CouponUsage,
// and a created coupon is immediately evaluable at checkout via the
// repository's snapshot.

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002";
}

export async function GET() {
  const guard = await requireAdmin("marketing.coupon");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  try {
    const coupons = await listCouponsDb();
    return NextResponse.json({ data: { coupons }, meta: { persistence: "database" } });
  } catch {
    return NextResponse.json({ error: { code: "DB_NOT_READY", message: "Coupons need a working database." } }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin("marketing.coupon");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = createCouponSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Invalid coupon.", details: parsed.error.issues } }, { status: 400 });
  try {
    if (await findCouponByCodeDb(parsed.data.code)) {
      return NextResponse.json({ error: { code: "CODE_EXISTS", message: "Coupon code already exists." } }, { status: 409 });
    }
    const coupon = await createCouponDb(parsed.data);
    return NextResponse.json({ data: { coupon }, meta: { persistence: "database" } }, { status: 201 });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return NextResponse.json({ error: { code: "CODE_EXISTS", message: "Coupon code already exists." } }, { status: 409 });
    }
    return NextResponse.json({ error: { code: "DB_NOT_READY", message: "Coupons need a working database." } }, { status: 503 });
  }
}
