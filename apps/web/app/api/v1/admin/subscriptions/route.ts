/**
 * GET /api/v1/admin/subscriptions — staff list of customer
 * subscriptions (ADV-18 remainder), guarded by orders.view. Customer
 * phones are masked through phoneForViewer like every other admin
 * surface (unmasked only for roles holding the reveal permission).
 *
 * The meta carries the honest generation state: orders are generated
 * ONLY by the worker-side sweep (src/subscriptions/generate.ts) —
 * until a worker host runs, ACTIVE subscriptions accumulate and
 * nextRunAt passes without an order appearing. That is stated here
 * and on the admin page, never hidden.
 */
import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { phoneForViewer } from "@/lib/rbac";
import { subscriptionsEnabled } from "@/subscriptions/flags";
import { listSubscriptionsForAdmin } from "@/subscriptions/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin("orders.view");
  if (!auth.ok) return NextResponse.json(guardError(auth), { status: auth.status });

  const subscriptions = await listSubscriptionsForAdmin();
  const masked = subscriptions.map((s) => ({
    ...s,
    customerPhone: phoneForViewer(s.customerPhone, auth.permissions) ?? "",
  }));
  return NextResponse.json({
    data: { subscriptions: masked },
    meta: {
      moduleEnabled: subscriptionsEnabled(),
      generation:
        "worker-sweep — orders are generated only when the worker host runs the subscription-generation queue",
    },
  });
}
