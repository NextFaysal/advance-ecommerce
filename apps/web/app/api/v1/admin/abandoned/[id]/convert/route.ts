/**
 * Convert an abandoned checkout into a REAL order —
 * POST /api/v1/admin/abandoned/[id]/convert (wave 22, doc 17 O4).
 *
 * The service (src/checkout/abandoned.convertAbandonedCheckout)
 * re-prices from the live catalog, prices shipping via the shipping
 * engine, scores fraud, and creates through createOrderRecord with
 * source "manual" + an internal note naming the capture — the same
 * funnel as a staff manual order. IDEMPOTENT: the create's
 * idempotency key derives from the capture id, and a RECOVERED
 * capture returns its existing order (meta.alreadyConverted) instead
 * of creating a duplicate. Stock/variant failures are 409 and the
 * capture stays OPEN.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { AbandonedError, convertAbandonedCheckout } from "@/checkout/abandoned";

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
  // Creating an order — the same permission as the manual create.
  const auth = await requireAdmin("orders.create");
  if ("error" in auth) return auth.error;

  try {
    const result = await convertAbandonedCheckout(params.id);
    if (!result.alreadyConverted) {
      await writeAudit({
        actorId: auth.session.user.id,
        action: "abandoned.convert",
        entityType: "AbandonedCheckout",
        entityId: params.id,
        afterJson: { orderId: result.orderId, orderNo: result.orderNo },
        ip: req.headers.get("x-forwarded-for") ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
      }).catch(() => null);
    }
    return NextResponse.json(
      {
        data: { orderId: result.orderId, orderNo: result.orderNo },
        meta: { alreadyConverted: result.alreadyConverted, db: "PRISMA", source: "DATABASE" },
      },
      { status: result.alreadyConverted ? 200 : 201 },
    );
  } catch (e) {
    if (e instanceof AbandonedError) return err(e.code, e.message, e.status, e.details);
    throw e;
  }
}
