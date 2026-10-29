/**
 * Admin stale-unpaid work list — GET /api/v1/admin/orders/stale-unpaid
 * (doc 17, O3). Query: ?hours= (default 24, clamped 1..720).
 *
 * Lists orders that are still PENDING + UNPAID past the cutoff AND
 * actually owe money up front: an advance requirement is persisted
 * (advanceRequiredPoisha > 0) or the method is prepaid (anything but
 * COD). Newest-stale first (closest to the cutoff first — the most
 * recoverable), capped at 100 rows; meta.total carries the uncapped
 * count. Phones are MASKED here with the validators maskPhone — a
 * full number never leaves this endpoint.
 *
 * HONESTY: this is a work list, NOT a sweep. Automatic cancellation
 * of stale unpaid orders is NOT active — the sweeper arrives with
 * the VPS worker (the queues have no consumer until then). Staff
 * work this list by hand; meta.autoCancelActive states it plainly.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { maskPhone } from "@advance-ecommerce/validators";
import { prisma } from "@advance-ecommerce/db";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
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

const MAX_ROWS = 100;

export async function GET(req: Request) {
  const auth = await requireAdmin("orders.view");
  if ("error" in auth) return auth.error;

  const rawHours = Number(new URL(req.url).searchParams.get("hours") ?? "24");
  const hours = Number.isFinite(rawHours) ? Math.min(720, Math.max(1, Math.trunc(rawHours))) : 24;

  // Perf (2026-10-29 orders speed wave): the computed work list is
  // cached for 60 s per hours value (src/orders/admin-cache) — the
  // query and mapping are unchanged; on a hit, ageHours/cutoff are
  // the compute-time values.
  const body = await readThroughOrdersCache(
    `admin:orders:stale-unpaid:v1:${hours}`,
    (
      parsed,
    ): parsed is {
      data: Array<{
        id: string;
        orderNo: string;
        createdAt: string;
        ageHours: number;
        totalPoisha: number;
        advanceRequiredPoisha: number;
        advanceSatisfied: boolean;
        paymentMethod: string;
        customerPhoneMasked: string;
      }>;
      meta: {
        db: string;
        source: string;
        hours: number;
        cutoff: string;
        total: number;
        capped: boolean;
        autoCancelActive: boolean;
        note: string;
      };
    } =>
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as { data?: unknown }).data) &&
      typeof (parsed as { meta?: { total?: unknown } }).meta?.total === "number",
    async () => {
      const now = new Date();
      const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);

      const where = {
        status: "PENDING" as const,
        paymentStatus: "UNPAID" as const,
        deletedAt: null,
        createdAt: { lt: cutoff },
        OR: [{ advanceRequiredPoisha: { gt: 0 } }, { paymentMethod: { not: "COD" as const } }],
      };

      const [total, orders] = await Promise.all([
        prisma.order.count({ where }),
        prisma.order.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: MAX_ROWS,
          select: {
            id: true,
            orderNo: true,
            createdAt: true,
            totalPoisha: true,
            advanceRequiredPoisha: true,
            advanceSatisfiedAt: true,
            paymentMethod: true,
            customerPhone: true,
          },
        }),
      ]);

      return {
        data: orders.map((o) => ({
          id: o.id,
          orderNo: o.orderNo,
          createdAt: o.createdAt.toISOString(),
          ageHours: Math.round(((now.getTime() - o.createdAt.getTime()) / 3_600_000) * 10) / 10,
          totalPoisha: o.totalPoisha,
          advanceRequiredPoisha: o.advanceRequiredPoisha,
          advanceSatisfied: o.advanceSatisfiedAt !== null,
          paymentMethod: o.paymentMethod,
          customerPhoneMasked: maskPhone(o.customerPhone),
        })),
        meta: {
          db: "PRISMA",
          source: "DATABASE",
          hours,
          cutoff: cutoff.toISOString(),
          total,
          capped: total > MAX_ROWS,
          autoCancelActive: false,
          note: "Automatic cancellation of stale unpaid orders is NOT active — it arrives with the VPS worker. This is a manual work list.",
        },
      };
    },
  );
  return NextResponse.json(body);
}
