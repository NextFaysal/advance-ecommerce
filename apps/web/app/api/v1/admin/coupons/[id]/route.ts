import { NextResponse } from "next/server";
import { z } from "zod";
import { setCouponActiveDb } from "@/marketing/repository";
import { guardError, requireAdmin } from "@/reports/guard";

// Coupon detail — PATCH ({ isActive } toggle) only. There is no full
// update or delete endpoint: definitions are created via the collection
// POST and usage history (CouponUsage) must stay immutable, so the one
// mutation the admin UI needs is activate/deactivate.
// RBAC: marketing.coupon (same as the collection route).

const couponActiveSchema = z.object({ isActive: z.boolean() });

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("marketing.coupon");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = couponActiveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid coupon toggle.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const coupon = await setCouponActiveDb(params.id, parsed.data.isActive);
    if (!coupon) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Coupon not found." } }, { status: 404 });
    }
    return NextResponse.json({ data: { coupon }, meta: { persistence: "database" } });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Coupons need a working database." } },
      { status: 503 },
    );
  }
}
