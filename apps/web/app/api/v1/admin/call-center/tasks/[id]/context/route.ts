import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { toQueueItemView } from "@/callcenter/queue";
import { loadTaskContext, type DbCallTask } from "@/callcenter/store";
import { maskPhone } from "@/checkout/validation";

// Customer 360 for one call task (C1) — GET /api/v1/admin/call-center/tasks/[id]/context
// RBAC: orders.view, same flag gate as the sibling call-center routes.
// Returns the task view + (for order-linked tasks) the full order,
// the customer's last 10 orders, and past call logs for the same
// phone/order. For a MANUAL task: the manual fields (in the task view)
// + past call logs matching its stored phone — no order block.
// Phone discipline is identical to the queue view: the task's full
// number travels only in phoneFull under customers.view_full_phone,
// and the order's customerPhone is masked unless the caller holds it.
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

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("orders.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isCallCenterEnabled(demoCallCenterFlags)) return locked();
  const canViewFullPhone = guard.permissions.includes("customers.view_full_phone");
  try {
    const ctx = await loadTaskContext(params.id);
    if (!ctx) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Call task not found." } },
        { status: 404 },
      );
    }
    return NextResponse.json({
      data: {
        task: view(ctx.task, canViewFullPhone),
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
