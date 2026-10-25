/**
 * POST /api/v1/admin/downloads/[id]/reject (doc 18, F3) — reject a
 * download re-issue request (products.edit). A reason (note) is
 * REQUIRED: the customer sees the request as rejected, and the
 * reason is what staff tell them why. The old grant is untouched —
 * rejection never revokes anything.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { rejectReissueRequest } from "@/catalog/download-reissue";

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
  REASON_REQUIRED: 400,
};

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("products.edit");
  if ("error" in auth) return auth.error;
  const body = (await req.json().catch(() => ({}))) as { note?: unknown };
  const out = await rejectReissueRequest({
    requestId: params.id,
    adminId: auth.session.user.id,
    note: typeof body.note === "string" ? body.note : undefined,
  });
  if (!out.ok) return err(out.code, out.error, ERROR_HTTP[out.code] ?? 400);
  return NextResponse.json({ data: out.value, meta: { db: "PRISMA", source: "DATABASE" } });
}
