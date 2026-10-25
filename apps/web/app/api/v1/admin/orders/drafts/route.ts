/**
 * Draft orders (doc 17, batch O9-2) —
 *   GET  /api/v1/admin/orders/drafts  (orders.view)  list, OPEN first
 *   POST /api/v1/admin/orders/drafts  (orders.create) create, or
 *        update an OPEN draft in place when the body carries `id`.
 *
 * A draft is a parked MANUAL-builder payload (see src/orders/drafts
 * for the contract): saving never validates it as an order, reserves
 * no stock and mints no order number. Conversion is the [id]/convert
 * route's job.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { listDraftOrders, saveDraftOrder, type DraftActor } from "@/orders/drafts";

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

function actorFrom(session: { user: { id: string; permissions: readonly string[] } }, req: Request): DraftActor {
  return {
    id: session.user.id,
    permissions: session.user.permissions,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  };
}

export async function GET() {
  const auth = await requireAdmin("orders.view");
  if ("error" in auth) return auth.error;
  const drafts = await listDraftOrders();
  return NextResponse.json({
    data: drafts,
    meta: { db: "PRISMA", source: "DATABASE", generatedAt: new Date().toISOString() },
  });
}

export async function POST(req: Request) {
  const auth = await requireAdmin("orders.create");
  if ("error" in auth) return auth.error;
  const body = (await req.json().catch(() => null)) as
    | { id?: unknown; payload?: unknown }
    | null;
  if (!body || typeof body !== "object") {
    return err("VALIDATION_ERROR", "Request body must be a JSON object.", 400);
  }
  const result = await saveDraftOrder(
    {
      id: typeof body.id === "string" && body.id !== "" ? body.id : undefined,
      payload: body.payload,
    },
    actorFrom(auth.session, req),
  );
  if (!result.ok) return err(result.code, result.message, result.httpStatus);
  return NextResponse.json(
    { data: result.draft, meta: { db: "PRISMA", source: "DATABASE" } },
    { status: 201 },
  );
}
