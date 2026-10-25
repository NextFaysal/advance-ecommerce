/**
 * Convert a draft order into a REAL order (doc 17, batch O9-2) —
 *   POST /api/v1/admin/orders/drafts/[id]/convert  (orders.create)
 *
 * The draft's stored payload is re-run through createManualOrder,
 * which re-validates variants + prices at conversion time exactly
 * like a fresh manual create (see src/orders/drafts for the
 * re-pricing rule). Idempotent: converting a CONVERTED draft returns
 * the linked order with meta.convertedReplay = true; a failed create
 * leaves the draft OPEN and surfaces the create failure verbatim.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { convertDraftOrder, type DraftActor } from "@/orders/drafts";

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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("orders.create");
  if ("error" in auth) return auth.error;
  const actor: DraftActor = {
    id: auth.session.user.id,
    permissions: auth.session.user.permissions,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  };
  const result = await convertDraftOrder(params.id, actor);
  if (!result.ok) return err(result.code, result.message, result.httpStatus, result.details);
  return NextResponse.json(
    {
      data: {
        draft: result.draft,
        order: result.order,
        orderId: result.orderId,
        orderNo: result.orderNo,
        pricing: result.pricing,
      },
      meta: {
        db: "PRISMA",
        source: "DATABASE",
        convertedReplay: result.replayed,
        idempotentReplay: result.replayed,
      },
    },
    { status: result.replayed ? 200 : 201 },
  );
}
