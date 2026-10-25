/**
 * Create a call-center follow-up task for an abandoned checkout —
 * POST /api/v1/admin/abandoned/[id]/call-task (wave 22, doc 17 O4).
 *
 * The task is an ABANDONED_CHECKOUT CallTask (the queue source lives
 * in CallTask.kind). Like a MANUAL task it has no linked order, so the
 * full phone persists on the task row server-side ONLY — this
 * endpoint returns just { ok, callTaskId } and never the number.
 * Idempotent: a capture that already has a task returns it.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { AbandonedError, createAbandonedCallTask } from "@/checkout/abandoned";

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
  const auth = await requireAdmin("orders.view");
  if ("error" in auth) return auth.error;

  try {
    const result = await createAbandonedCallTask(params.id);
    if (!result.alreadyCreated) {
      await writeAudit({
        actorId: auth.session.user.id,
        action: "abandoned.call_task",
        entityType: "AbandonedCheckout",
        entityId: params.id,
        afterJson: { callTaskId: result.callTaskId },
        ip: req.headers.get("x-forwarded-for") ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
      }).catch(() => null);
    }
    return NextResponse.json({
      data: { ok: true, callTaskId: result.callTaskId, alreadyCreated: result.alreadyCreated },
    });
  } catch (e) {
    if (e instanceof AbandonedError) return err(e.code, e.message, e.status, e.details);
    throw e;
  }
}
