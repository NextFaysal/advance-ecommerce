/**
 * Order merge — POST /api/v1/admin/orders/merge (ADV-19, doc 22).
 *
 * Body: { sourceOrderId, targetOrderId, dryRun?: true }.
 *  - dryRun: returns the preflight verdicts only — nothing is
 *    written. The orders-admin merge dialog uses it to show staff
 *    exactly which guards pass/fail before they commit.
 *  - real run: src/orders/merge owns the operation (lines move via
 *    the order-edit machinery, source cancelled via
 *    applyOrderTransition with the merge reason, notes on both
 *    orders). This route adds the orders.merge audit row.
 *
 * A merge NEVER deletes an order row — the source stays as a
 * CANCELLED order with its full history. Guard: orders.edit (the
 * merge is an edit of the target + a status change of the source).
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { mergeOrders, preflightMerge } from "@/orders/merge";

export const dynamic = "force-dynamic";

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

const bodySchema = z.object({
  sourceOrderId: z.string().min(1),
  targetOrderId: z.string().min(1),
  dryRun: z.boolean().optional(),
});

const ERROR_HTTP: Record<string, number> = {
  INVALID_INPUT: 400,
  ORDER_NOT_FOUND: 404,
  MERGE_REFUSED: 409,
  EDIT_FAILED: 409,
  CANCEL_FAILED: 500,
};

export async function POST(req: Request) {
  const auth = await requireAdmin("orders.edit");
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return err(
      "VALIDATION_ERROR",
      "Merge input invalid.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const { sourceOrderId, targetOrderId, dryRun } = parsed.data;

  if (dryRun) {
    const preflight = await preflightMerge(sourceOrderId, targetOrderId);
    return NextResponse.json({
      data: preflight,
      meta: { db: "PRISMA", source: "DATABASE", dryRun: true },
    });
  }

  const result = await mergeOrders(sourceOrderId, targetOrderId, {
    id: auth.session.user.id,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  if (!result.ok) {
    return err(result.code, result.error, ERROR_HTTP[result.code] ?? 400, result.verdicts);
  }

  await writeAudit({
    actorId: auth.session.user.id,
    action: "orders.merge",
    entityType: "Order",
    entityId: result.value.targetOrderId,
    beforeJson: { ...result.value.edit.before },
    afterJson: {
      ...result.value.edit.after,
      sourceOrderId: result.value.sourceOrderId,
      sourceOrderNo: result.value.sourceOrderNo,
      sourceCancelledWithReason: `অর্ডার মার্জ: ${result.value.targetOrderNo}`,
      movedLines: result.value.movedLines,
      sourceReservationsReleasedEarly: result.value.sourceReservationsReleasedEarly,
      couponRemoved: result.value.edit.couponRemoved,
    },
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });

  return NextResponse.json({
    data: result.value,
    meta: { db: "PRISMA", source: "DATABASE" },
  });
}
