/**
 * Dismiss an abandoned checkout —
 * POST /api/v1/admin/abandoned/[id]/dismiss (wave 22, doc 17 O4).
 *
 * Marks the capture DISMISSED (a closed state: it leaves the admin
 * list and a late capture from the same session can never resurrect
 * it). A RECOVERED capture cannot be dismissed (409). Dismissing an
 * already-dismissed capture is an idempotent 200.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { AbandonedError, dismissAbandonedCheckout } from "@/checkout/abandoned";

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
  const auth = await requireAdmin("orders.update_status");
  if ("error" in auth) return auth.error;

  try {
    const result = await dismissAbandonedCheckout(params.id);
    if (!result.alreadyDismissed) {
      await writeAudit({
        actorId: auth.session.user.id,
        action: "abandoned.dismiss",
        entityType: "AbandonedCheckout",
        entityId: params.id,
        afterJson: { status: "DISMISSED" },
        ip: req.headers.get("x-forwarded-for") ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
      }).catch(() => null);
    }
    return NextResponse.json({
      data: { ok: true, alreadyDismissed: result.alreadyDismissed },
    });
  } catch (e) {
    if (e instanceof AbandonedError) return err(e.code, e.message, e.status, e.details);
    throw e;
  }
}
