/**
 * Admin order phone reveal — GET /api/v1/admin/orders/[id]/phone
 * (doc 17, batch O6-2).
 *
 * Everywhere else on the orders path the customer phone is masked
 * server-side (phoneForViewer). This is the ONE orders-path endpoint
 * that returns the full number, and it is deliberately narrow:
 *
 *   - Guard: a valid admin session PLUS the customers.view_full_phone
 *     permission (401 unauthenticated, 403 without the permission).
 *   - EVERY successful reveal writes an audit row FIRST
 *     (action "orders.phone_view", actor + order as the entity,
 *     mirroring the call-center's call_center.phone_view pattern)
 *     and only then returns the number. The number itself is never
 *     written into the audit row.
 *   - The response carries the phone and nothing else — no name, no
 *     address, no other PII rides along.
 *
 * Audit is awaited before the response; writeAudit itself is
 * best-effort by design (it logs and returns null on a write
 * failure rather than throwing), matching the codebase's other
 * phone-access logging (lib/audit logPhoneAccess).
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@advance-ecommerce/db";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";

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

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("customers.view_full_phone");
  if ("error" in auth) return auth.error;

  // Same lookup convention as the order detail route: id or orderNo.
  const order = await prisma.order.findFirst({
    where: { deletedAt: null, OR: [{ id: params.id }, { orderNo: params.id }] },
    select: { id: true, customerPhone: true },
  });
  if (!order) return err("NOT_FOUND", "Order not found.", 404);

  await writeAudit({
    actorId: auth.session.user.id,
    action: "orders.phone_view",
    entityType: "Order",
    entityId: order.id,
    afterJson: { via: "order_detail" },
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });

  return NextResponse.json({
    data: { phone: order.customerPhone },
    meta: { db: "PRISMA", source: "DATABASE", audited: true },
  });
}
