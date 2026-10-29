/**
 * POS sales for the orders team — GET /api/v1/admin/orders/pos-sales
 * ?from&to (doc 17, batch O9-2). Guard: orders.view.
 *
 * READ-ONLY by design: POS sales already moved their stock inside
 * the POS flow, so they are reported here, never converted into
 * Orders (that would double-count). Range params are Asia/Dhaka
 * calendar days, inclusive; defaults are the last 30 days — the
 * shared parseAdminRange convention (KPI pack, delivery costs).
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { getPosSalesReport, type PosSalesReport } from "@/orders/pos-sales";
import { parseAdminRange } from "@/orders/range-params";
import { readThroughOrdersCache } from "@/orders/admin-cache";

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

  // Perf (2026-10-29 orders speed wave): the computed report is
  // cached for 60 s per range (src/orders/admin-cache) — the math
  // is unchanged; on a hit, generatedAt is the compute time.
  const body = await readThroughOrdersCache(
    `admin:orders:pos-sales:v1:${range.from}:${range.to}`,
    (parsed): parsed is { data: PosSalesReport; meta: { db: string; source: string; generatedAt: string } } =>
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as { data?: { rows?: unknown } }).data?.rows),
    async () => ({
      data: await getPosSalesReport(range.from, range.to),
      meta: { db: "PRISMA", source: "DATABASE", generatedAt: new Date().toISOString() },
    }),
  );
  return NextResponse.json(body);
}
