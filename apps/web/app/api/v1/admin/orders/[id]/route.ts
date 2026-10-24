/**
 * Admin order detail — /api/v1/admin/orders/[id]
 * GET: detail (masked phone by default). PATCH: status transition.
 *
 * PATCH rules (real, via src/orders/state-machine — the single
 * authority for transitions):
 * - requires orders.update_status
 * - invalid transitions are REJECTED (422), never coerced, and write
 *   nothing to the DB
 * - reason is REQUIRED for CANCELLED and REFUNDED (state-machine check)
 * - the transition is audited (writeAudit, best-effort)
 *
 * DB-BACKED: the order is loaded from and persisted to Prisma via
 * src/orders/repository. PATCH goes through applyOrderTransition():
 * state machine decides, then Order.status + OrderStatusHistory are
 * written in one transaction. meta.persisted = true is now truthful.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { phoneForViewer, requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { applyOrderTransition, getOrderByIdOrNo } from "@/orders/repository";
import type { OrderStatus } from "@/orders/types";

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
  const order = await getOrderByIdOrNo(params.id);
  if (!order) return err("NOT_FOUND", "Order not found.", 404);
  const view = { ...order, customerPhone: phoneForViewer(order.customerPhone, auth.session.user.permissions) ?? "" };
  return NextResponse.json({ data: view, meta: { db: "PRISMA", source: "DATABASE" } });
}

const patchSchema = z.object({
  to: z.enum([
    "PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED",
    "FAILED", "RETURN_REQUESTED", "RETURNING", "RETURNED", "CANCELLED", "REFUNDED", "EXCHANGED",
  ]),
  reason: z.string().min(1).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("orders.update_status");
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", "Status transition input invalid.", 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const result = await applyOrderTransition(
    params.id,
    parsed.data.to as OrderStatus,
    auth.session.user.id,
    parsed.data.reason,
  );
  if (result.kind === "not_found") return err("NOT_FOUND", "Order not found.", 404);
  if (result.kind === "invalid") {
    return err("INVALID_TRANSITION", result.error, 422);
  }
  await writeAudit({
    actorId: auth.session.user.id,
    action: "orders.update_status",
    entityType: "Order",
    entityId: result.order.id,
    beforeJson: { status: result.from },
    afterJson: { status: parsed.data.to },
    reason: parsed.data.reason,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  return NextResponse.json({
    data: { ...result.order, customerPhone: phoneForViewer(result.order.customerPhone, auth.session.user.permissions) ?? "" },
    meta: { db: "PRISMA", persisted: true },
  });
}
