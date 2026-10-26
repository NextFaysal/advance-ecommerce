import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { listApprovalQueue } from "@/orders/approvals";

// GET /api/v1/admin/approvals — the manager approval queue
// (ADV-27): discount-approval requests recorded when a confirm was
// blocked, and refund-approval requests recorded for refunds above
// the threshold. Read guard: orders.view. Decisions go through
// POST /api/v1/admin/approvals/[id]/decide (orders.edit).
// The current orders.approvals.* configuration rides along so the
// page can show exactly which rule produced the queue.

export async function GET() {
  const guard = await requireAdmin("orders.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  try {
    const { config, entries } = await listApprovalQueue();
    return NextResponse.json({
      data: { config, entries },
      meta: { persistence: "database" },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Approvals need a working database." } },
      { status: 503 },
    );
  }
}
