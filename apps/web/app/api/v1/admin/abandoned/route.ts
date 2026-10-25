/**
 * Admin abandoned-checkout list — GET /api/v1/admin/abandoned
 * (wave 22, doc 17 batch O4).
 *
 * OPEN captures that have not expired (7 days from capture), newest
 * activity first, capped at 100 rows; meta.total carries the uncapped
 * count. Phones are MASKED in the service (src/checkout/abandoned) —
 * a full number never leaves this endpoint. meta.expiresAfterDays
 * states the retention honestly: expired rows drop off this list.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { listOpenAbandonedCheckouts } from "@/checkout/abandoned";

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

export async function GET() {
  const auth = await requireAdmin("orders.view");
  if ("error" in auth) return auth.error;

  const { rows, total } = await listOpenAbandonedCheckouts();
  return NextResponse.json({
    data: rows,
    meta: { total, expiresAfterDays: 7, db: "PRISMA", source: "DATABASE" },
  });
}
