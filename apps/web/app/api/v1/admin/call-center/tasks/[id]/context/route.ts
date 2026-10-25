import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { checkContextAccess, toQueueItemView } from "@/callcenter/queue";
import { loadCallTask, loadTaskContext, type DbCallTask } from "@/callcenter/store";
import { maskPhone } from "@/checkout/validation";
import { writeAudit } from "@/lib/audit";

// Customer 360 for one call task (C1) — GET /api/v1/admin/call-center/tasks/[id]/context
// RBAC: orders.view, same flag gate as the sibling call-center routes.
// Returns the task view + (for order-linked tasks) the full order,
// the customer's last 10 orders, and past call logs for the same
// phone/order. For a MANUAL task: the manual fields (in the task view)
// + past call logs matching its stored phone — no order block.
// Phone discipline is identical to the queue view: the task's full
// number travels only in phoneFull under customers.view_full_phone,
// and the order's customerPhone is masked unless the caller holds it.
// Context scoping (plan doc 15, R2.5 — decided with doc 18 F2,
// 2026-10-25): beyond the orders.view base guard, the payload is
// restricted to the task's ASSIGNED agent plus staff.manage holders
// (supervisor override, mirroring the G3 outcome gate). Unassigned
// tasks answer 409 TASK_UNASSIGNED (claim first); another agent's
// task answers 403 TASK_ASSIGNED_TO_OTHER. The scoping never widens
// phone visibility — masking + the R6.1 reveal audit below are
// unchanged, and a refused read reveals and audits nothing.
function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "Call center module is locked for this install (module.call_center is OFF)." } },
    { status: 403 },
  );
}

function dbNotReady() {
  return NextResponse.json(
    { error: { code: "DB_NOT_READY", message: "Call-center database is not available." } },
    { status: 503 },
  );
}

function view(task: DbCallTask, canViewFullPhone: boolean) {
  return toQueueItemView(task, canViewFullPhone && task.phoneResolved === true);
}

/**
 * Full-phone access audit (plan doc 15, R6.1 / C7 privacy hardening):
 * when this response reveals a FULL phone — the task view's phoneFull,
 * or the linked order's customerPhone going out unmasked — record WHO
 * saw WHICH task's number WHEN in the real AuditLog (readable on
 * /admin/audit). The number itself — full or masked — is NEVER written
 * to the audit row; only the access event (actor, task, source,
 * channel). Masked-only views write nothing. Best-effort: an audit
 * failure must never fail the request.
 */
async function auditPhoneView(
  taskView: ReturnType<typeof view>,
  orderPhoneRevealed: boolean,
  actorId: string,
): Promise<void> {
  if (!taskView.phoneFull && !orderPhoneRevealed) return;
  try {
    await writeAudit({
      actorId,
      action: "call_center.phone_view",
      entityType: "CallTask",
      entityId: taskView.id,
      afterJson: { taskId: taskView.id, source: taskView.source, via: "context" },
    });
  } catch {
    /* audit is best-effort here */
  }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("orders.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  await ensureDbFeatureFlags();
  if (!isCallCenterEnabled(demoCallCenterFlags)) return locked();
  const canViewFullPhone = guard.permissions.includes("customers.view_full_phone");
  const isSupervisor = guard.permissions.includes("staff.manage");
  try {
    // R2.5 scoping: resolve the task + its assignment BEFORE assembling
    // (or revealing) any context — a refused caller gets no payload.
    const task = await loadCallTask(params.id);
    if (!task) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Call task not found." } },
        { status: 404 },
      );
    }
    const access = checkContextAccess(task, guard.userId, isSupervisor);
    if (!access.allowed) {
      if (access.code === "TASK_UNASSIGNED") {
        return NextResponse.json(
          {
            error: {
              code: access.code,
              message: access.error,
              details: { hint: "Claim the task first: POST /api/v1/admin/call-center/claim" },
            },
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: { code: access.code, message: access.error } },
        { status: 403 },
      );
    }
    const ctx = await loadTaskContext(params.id);
    if (!ctx) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Call task not found." } },
        { status: 404 },
      );
    }
    const taskView = view(ctx.task, canViewFullPhone);
    await auditPhoneView(taskView, canViewFullPhone && ctx.order !== null, guard.userId);
    return NextResponse.json({
      data: {
        task: taskView,
        order: ctx.order
          ? {
              ...ctx.order,
              customerPhone: canViewFullPhone
                ? ctx.order.customerPhone
                : maskPhone(ctx.order.customerPhone),
            }
          : null,
        recentOrders: ctx.recentOrders,
        pastCalls: ctx.pastCalls,
      },
      meta: { persistence: "database", module: "module.call_center" },
    });
  } catch {
    return dbNotReady();
  }
}
