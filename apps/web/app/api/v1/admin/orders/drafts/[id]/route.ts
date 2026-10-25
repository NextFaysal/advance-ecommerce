/**
 * One draft order (doc 17, batch O9-2) —
 *   GET    /api/v1/admin/orders/drafts/[id]  (orders.view)
 *   DELETE /api/v1/admin/orders/drafts/[id]  (orders.create) discard:
 *          OPEN -> DISCARDED. Not a hard delete — the row stays so the
 *          audit trail and the list's history stay truthful.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { discardDraftOrder, getDraftOrder, type DraftActor } from "@/orders/drafts";

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

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("orders.view");
  if ("error" in auth) return auth.error;
  const draft = await getDraftOrder(params.id);
  if (!draft) return err("NOT_FOUND", "ড্রাফট পাওয়া যায়নি। / Draft not found.", 404);
  return NextResponse.json({
    data: draft,
    meta: { db: "PRISMA", source: "DATABASE" },
  });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("orders.create");
  if ("error" in auth) return auth.error;
  const actor: DraftActor = {
    id: auth.session.user.id,
    permissions: auth.session.user.permissions,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  };
  const result = await discardDraftOrder(params.id, actor);
  if (!result.ok) return err(result.code, result.message, result.httpStatus);
  return NextResponse.json({
    data: result.draft,
    meta: { db: "PRISMA", source: "DATABASE" },
  });
}
