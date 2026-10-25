/**
 * Admin refund status moves — PATCH /api/v1/admin/orders/[id]/refunds/[refundId]
 * (doc 17, O0; permission payments.refund)
 * Body: { to: "SENT" | "CONFIRMED" | "CANCELLED", reference?, reason? }
 * Lifecycle (src/orders/refunds.ts): PENDING → SENT → CONFIRMED, and
 * PENDING → CANCELLED. Marking SENT requires the payout reference and
 * recomputes the order's paymentStatus via markOrderPayment.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { updateRefundStatus, type RefundResult } from "@/orders/refunds";

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
  ORDER_NOT_FOUND: 404,
  REFUND_NOT_FOUND: 404,
  INVALID_INPUT: 400,
  REASON_REQUIRED: 400,
  REFERENCE_REQUIRED: 400,
  OVER_REFUND: 409,
  INVALID_TRANSITION: 409,
};

function unwrap<T>(result: RefundResult<T>): { value: T } | { response: NextResponse } {
  if (result.ok) return { value: result.value };
  return { response: err(result.code, result.error, ERROR_HTTP[result.code] ?? 400) };
}

const patchSchema = z.object({
  to: z.enum(["SENT", "CONFIRMED", "CANCELLED"]),
  reference: z.string().trim().max(120).optional().nullable(),
  reason: z.string().trim().min(1).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; refundId: string } },
) {
  const auth = await requireAdmin("payments.refund");
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return err("INVALID_INPUT", "to (SENT | CONFIRMED | CANCELLED) is required. / গন্তব্য অবস্থা আবশ্যক।", 400);
  }
  // The refund must belong to the order in the path — never act on a
  // refund id smuggled under another order's URL. params.id may be the
  // order id or the order number; resolve it the funnel's way.
  const order = await prisma.order.findFirst({
    where: { deletedAt: null, OR: [{ id: params.id }, { orderNo: params.id }] },
    select: { id: true },
  });
  const owned = order
    ? await prisma.refund.findFirst({
        where: { id: params.refundId, orderId: order.id },
        select: { id: true },
      })
    : null;
  if (!owned) return err("REFUND_NOT_FOUND", "Refund not found for this order.", 404);
  const out = unwrap(
    await updateRefundStatus(
      params.refundId,
      {
        to: parsed.data.to,
        reference: parsed.data.reference ?? undefined,
        reason: parsed.data.reason,
      },
      auth.session.user.id,
    ),
  );
  if ("response" in out) return out.response;
  return NextResponse.json({
    data: out.value,
    meta: { db: "PRISMA", source: "DATABASE" },
  });
}
