/**
 * Admin returns queue — /api/v1/admin/returns (doc 17, O7)
 * GET: every return, newest first, with an optional ?status= filter
 * and ?page= / ?pageSize= pagination (returns.view). meta carries
 * the full-set total + per-status counts (counts ignore the status
 * filter, the list-v2 convention, so the chips stay meaningful).
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { listReturns, type ReturnResult } from "@/orders/returns";

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

const ERROR_HTTP: Record<string, number> = {
  INVALID_INPUT: 400,
};

function unwrap<T>(result: ReturnResult<T>): { value: T } | { response: NextResponse } {
  if (result.ok) return { value: result.value };
  return { response: err(result.code, result.error, ERROR_HTTP[result.code] ?? 400) };
}

export async function GET(req: Request) {
  const auth = await requireAdmin("returns.view");
  if ("error" in auth) return auth.error;
  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "25");
  const out = unwrap(
    await listReturns({
      status: url.searchParams.get("status") ?? undefined,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 25,
    }),
  );
  if ("response" in out) return out.response;
  return NextResponse.json({
    data: out.value.returns,
    meta: {
      db: "PRISMA",
      source: "DATABASE",
      total: out.value.total,
      counts: out.value.counts,
      page: Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1,
      pageSize: Math.min(100, Math.max(1, Math.floor(Number.isFinite(pageSize) ? pageSize : 25))),
    },
  });
}
