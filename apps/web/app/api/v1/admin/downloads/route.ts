/**
 * Admin download re-issue queue — /api/v1/admin/downloads (doc 18, F3)
 * GET: re-issue requests, newest first, with an optional ?status=
 * filter (PENDING | APPROVED | REJECTED) and ?page= / ?pageSize=
 * pagination. Reads guard on products.view; meta carries the full-set
 * total + per-status counts (counts ignore the status filter, the
 * list-v2 convention). Customer phones arrive MASKED — the full
 * number never reaches the admin page.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { listReissueRequests } from "@/catalog/download-reissue";

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

const STATUSES = ["PENDING", "APPROVED", "REJECTED"];

export async function GET(req: Request) {
  const auth = await requireAdmin("products.view");
  if ("error" in auth) return auth.error;
  const url = new URL(req.url);
  const statusRaw = url.searchParams.get("status") ?? undefined;
  const status = statusRaw && STATUSES.includes(statusRaw) ? statusRaw : undefined;
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "25");
  const out = await listReissueRequests({
    status,
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 25,
  });
  return NextResponse.json({
    data: out.requests,
    meta: {
      db: "PRISMA",
      source: "DATABASE",
      total: out.total,
      counts: out.counts,
      page: Number.isFinite(page) ? Math.max(1, page) : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 25,
    },
  });
}
