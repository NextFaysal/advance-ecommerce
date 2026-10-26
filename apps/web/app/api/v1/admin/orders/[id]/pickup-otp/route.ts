/**
 * GET /api/v1/admin/orders/[id]/pickup-otp — pickup OTP status for
 * the admin order page panel (ADV-19 remainder), guarded by
 * orders.view. Returns whether the order is a pickup order at all
 * (applicable), whether a code was issued, and whether the handover
 * is verified — the panel hides itself when applicable is false.
 * The code itself NEVER leaves the server (hash-only storage).
 */
import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { getPickupOtpStatus } from "@/orders/pickup-otp";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("orders.view");
  if (!auth.ok) return NextResponse.json(guardError(auth), { status: auth.status });

  const status = await getPickupOtpStatus(params.id);
  if (status === null) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Order not found." } },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: status, meta: { source: "pickup-otp" } });
}
