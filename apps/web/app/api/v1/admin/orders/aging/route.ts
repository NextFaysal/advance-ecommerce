/**
 * Admin orders aging board — GET /api/v1/admin/orders/aging
 * (doc 17, batch O6-2). Guard: orders.view.
 *
 * The stuck-work view the orders list never had: four buckets of
 * orders sitting too long in one state (pending >24h, confirmed but
 * unpacked >48h, shipped but undelivered >5d, returning >7d). Each
 * bucket carries its FULL SQL count plus the top-10 oldest rows —
 * computed in src/orders/list-v2 (getOrderAging), never by slicing a
 * fetched list. Phones are masked in the service; a full number never
 * leaves this endpoint.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { getOrderAging, type AgingBucket } from "@/orders/list-v2";
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

export async function GET() {
  const auth = await requireAdmin("orders.view");
  if ("error" in auth) return auth.error;

  // Perf (2026-10-29 orders speed wave): the computed board is
  // cached for 60 s (src/orders/admin-cache) — counts, rows and
  // ageHours are exactly the compute-time values on a hit, and
  // generatedAt says when they were computed. The buckets also
  // compute concurrently now (src/orders/list-v2).
  const body = await readThroughOrdersCache(
    "admin:orders:aging:v1",
    (
      parsed,
    ): parsed is {
      data: AgingBucket[];
      meta: {
        db: string;
        source: string;
        generatedAt: string;
        totalStuck: number;
        note: string;
      };
    } =>
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as { data?: unknown }).data),
    async () => {
      const now = new Date();
      const buckets = await getOrderAging(now);
      const totalStuck = buckets.reduce((sum, b) => sum + b.count, 0);
      return {
        data: buckets,
        meta: {
          db: "PRISMA",
          source: "DATABASE",
          generatedAt: now.toISOString(),
          totalStuck,
          note: "Counts are full SQL counts per bucket; orders are the 10 oldest per bucket. Age is measured from createdAt for pending orders and from updatedAt for the other buckets.",
        },
      };
    },
  );
  return NextResponse.json(body);
}
