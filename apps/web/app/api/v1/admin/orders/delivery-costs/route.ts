/**
 * Failed-delivery cost ledger — GET
 * /api/v1/admin/orders/delivery-costs?from&to (doc 17, batch O8-2).
 * Guard: orders.view.
 *
 * Read model from src/orders/delivery-costs: per order that reached
 * FAILED or RETURNED in the range, the courier charge actually
 * booked (Σ Shipment.chargePoisha) and the return-leg charge —
 * which no booking record carries, so it is returned as null with
 * returnCostRecorded: false rather than an invented number. Range
 * params are Asia/Dhaka calendar days, inclusive; defaults are the
 * last 30 days.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { getDeliveryCosts } from "@/orders/delivery-costs";
import { parseAdminRange } from "@/orders/range-params";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

async function requireAdmin(permission: PermissionKey) {
  const token = cookies().get("admin_session")?.value;
  if (!token) return { error: err("UNAUTHENTICATED", "Admin login required.", 401) };
  try {
    const session = await validateSessionToken(token);
    if (!session) return { error: err("UNAUTHENTICATED", "Session expired or revoked.", 401) };
    requirePermission(session.user.permissions, permission);
    return { session };
  } catch (e) {
    if (e instanceof RbacError) return { error: err("FORBIDDEN", e.message, 403) };
    return { error: err("DB_NOT_READY", "Session check needs a working database (Prisma generate + DB connection).", 503) };
  }
}

export async function GET(req: Request) {
  const auth = await requireAdmin("orders.view");
  if ("error" in auth) return auth.error;

  const range = parseAdminRange(new URL(req.url).searchParams);
  if (!range.ok) return err("INVALID_INPUT", range.message, 400);

  const costs = await getDeliveryCosts(range.from, range.to);
  return NextResponse.json({
    data: costs,
    meta: { db: "PRISMA", source: "DATABASE", generatedAt: new Date().toISOString() },
  });
}
