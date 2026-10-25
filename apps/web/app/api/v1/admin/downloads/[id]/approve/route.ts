/**
 * POST /api/v1/admin/downloads/[id]/approve (doc 18, F3) — approve a
 * download re-issue request (products.edit). Mints a NEW grant for
 * the same file/order, revokes the OLD grant (both redemption paths
 * refuse revoked grants) and records the link on the request.
 *
 * The response carries the new grant's one-time downloadPath (raw
 * token included) — the ONLY place it ever surfaces, for staff to
 * relay to the customer if needed. It is never stored and never
 * written to the audit log; the customer can also just use the
 * Download button in their account, which needs no token at all.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { approveReissueRequest } from "@/catalog/download-reissue";

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
  NOT_FOUND: 404,
  INVALID_STATE: 409,
};

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("products.edit");
  if ("error" in auth) return auth.error;
  const body = (await req.json().catch(() => ({}))) as { note?: unknown };
  const out = await approveReissueRequest({
    requestId: params.id,
    adminId: auth.session.user.id,
    note: typeof body.note === "string" ? body.note : undefined,
  });
  if (!out.ok) return err(out.code, out.error, ERROR_HTTP[out.code] ?? 400);
  return NextResponse.json({ data: out.value, meta: { db: "PRISMA", source: "DATABASE" } });
}
