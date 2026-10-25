/**
 * Admin return detail + lifecycle — /api/v1/admin/returns/[id] (doc 17, O7)
 * GET:  one return with its lines (returns.view).
 * POST: move the lifecycle (returns.manage) —
 *   { to: "APPROVED" }
 *   { to: "REJECTED", reason }                       (reason required)
 *   { to: "RECEIVED", lineConditions: [{ orderItemId, condition:
 *        "restockable" | "damaged" }], qcNote? }     (restocks here)
 *   { to: "COMPLETED" }   (creates the ONE PENDING workbench refund)
 *   { to: "CLOSED", reason? }                        (all-damaged only)
 * The service (src/orders/returns.ts) owns every rule; this route only
 * authenticates, validates and maps errors.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { getReturn, transitionReturn, type ReturnResult } from "@/orders/returns";

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
  RETURN_NOT_FOUND: 404,
  ORDER_NOT_DELIVERED: 409,
  INVALID_INPUT: 400,
  LINE_NOT_IN_ORDER: 400,
  INVALID_QUANTITY: 400,
  QUANTITY_EXCEEDED: 409,
  DUPLICATE_OPEN_RETURN: 409,
  REASON_REQUIRED: 400,
  INVALID_TRANSITION: 409,
  CONDITIONS_INCOMPLETE: 400,
  NO_REFUNDABLE_LINES: 409,
  REFUND_NOT_POSSIBLE: 409,
};

function unwrap<T>(result: ReturnResult<T>): { value: T } | { response: NextResponse } {
  if (result.ok) return { value: result.value };
  return { response: err(result.code, result.error, ERROR_HTTP[result.code] ?? 400) };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("returns.view");
  if ("error" in auth) return auth.error;
  const out = unwrap(await getReturn(params.id));
  if ("response" in out) return out.response;
  return NextResponse.json({
    data: out.value,
    meta: { db: "PRISMA", source: "DATABASE" },
  });
}

const transitionSchema = z.object({
  to: z.enum(["APPROVED", "REJECTED", "RECEIVED", "COMPLETED", "CLOSED"]),
  reason: z.string().trim().max(1000).optional(),
  qcNote: z.string().trim().max(1000).optional(),
  lineConditions: z
    .array(
      z.object({
        orderItemId: z.string().min(1),
        condition: z.enum(["restockable", "damaged"]),
      }),
    )
    .optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("returns.manage");
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  const parsed = transitionSchema.safeParse(body);
  if (!parsed.success) {
    return err("INVALID_INPUT", "Invalid transition input. / অবস্থা বদলের তথ্য সঠিক নয়।", 400, parsed.error.issues);
  }
  const actor = { id: auth.session.user.id, label: auth.session.user.id };
  const out = unwrap(
    await transitionReturn(params.id, parsed.data.to, actor, {
      reason: parsed.data.reason,
      qcNote: parsed.data.qcNote,
      lineConditions: parsed.data.lineConditions,
    }),
  );
  if ("response" in out) return out.response;
  // Customer notification (wave 25 parent wiring): enqueue an sms-send job
  // for the new status. Best-effort only — a queue failure never fails the
  // transition the staff member just completed. Delivery needs the worker.
  try {
    const { notifyReturnStatus } = await import("@/orders/return-notify");
    await notifyReturnStatus(params.id, parsed.data.to);
  } catch {
    // notification enqueue failed; the transition itself already succeeded
  }
  return NextResponse.json({
    data: out.value,
    meta: { db: "PRISMA", source: "DATABASE" },
  });
}
