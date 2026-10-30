/**
 * POST /api/v1/admin/boxes/sweep — Manual trigger for subscription box generation.
 * Staff action to sweep due subscriptions immediately (e.g. for testing,
 * manual processing, or forced cycles).
 * Requires permission 'orders.edit'.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { subscriptionBoxesEnabled, SUBSCRIPTION_BOXES_FLAG } from "@/boxes/flags";
import { subscriptionsEnabled, SUBSCRIPTIONS_FLAG_KEY } from "@/subscriptions/flags";
import { processDueSubscriptions } from "@/subscriptions/generate";

export const dynamic = "force-dynamic";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

async function requireAdmin(permission: "orders.edit") {
  const token = cookies().get("admin_session")?.value;
  if (!token) return { error: err("UNAUTHENTICATED", "Admin login required.", 401) };
  try {
    const session = await validateSessionToken(token);
    if (!session) return { error: err("UNAUTHENTICATED", "Session expired or revoked.", 401) };
    requirePermission(session.user.permissions, permission);
    return { session };
  } catch (e) {
    if (e instanceof RbacError) return { error: err("FORBIDDEN", e.message, 403) };
    return { error: err("DB_NOT_READY", "Session check needs a working database.", 503) };
  }
}

export async function POST() {
  const auth = await requireAdmin("orders.edit");
  if ("error" in auth) return auth.error;

  if (!subscriptionsEnabled()) {
    return err(
      "FEATURE_LOCKED",
      `The subscription engine flag '${SUBSCRIPTIONS_FLAG_KEY}' is disabled.`,
      403,
    );
  }

  if (!subscriptionBoxesEnabled()) {
    return err(
      "FEATURE_LOCKED",
      `The subscription boxes layer flag '${SUBSCRIPTION_BOXES_FLAG}' is disabled.`,
      403,
    );
  }

  const now = new Date();
  const result = await processDueSubscriptions(now);

  await writeAudit({
    actorId: auth.session.user.id,
    action: "boxes.sweep.manual",
    entityType: "Subscription",
    entityId: "manual-sweep",
    beforeJson: null,
    afterJson: {
      due: result.due,
      created: result.created,
      failed: result.failed,
      boxesSkipped: result.boxesSkipped,
      orderCount: result.orderIds.length,
    },
    reason: "Manual admin trigger for due subscription boxes sweep",
  });

  return NextResponse.json({
    data: result,
    meta: {
      triggeredAt: now.toISOString(),
      triggeredBy: auth.session.user.id,
    },
  });
}
