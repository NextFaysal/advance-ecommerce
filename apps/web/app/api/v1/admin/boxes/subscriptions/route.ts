/**
 * GET /api/v1/admin/boxes/subscriptions — staff list of BOX
 * subscriptions (ADV-23 vertical 4), guarded by orders.view.
 *
 * Rows are the wave-51 Subscription records whose variant is
 * listed in boxes.config, each joined with its cycle extras (next
 * cycle + whether its contents are defined, last generated cycle).
 * Customer phones are masked through phoneForViewer like every
 * other admin surface.
 *
 * The meta carries the honest generation state, mirroring the
 * wave-51 admin list: box orders are generated ONLY by the
 * worker-side sweep (src/subscriptions/generate.ts, box branch in
 * src/boxes/generate.ts) — until a worker host runs, due cycles
 * pass without an order appearing, and a due cycle whose contents
 * are not defined is skipped with BOX_CONTENTS_MISSING on the row.
 */
import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { phoneForViewer } from "@/lib/rbac";
import { subscriptionBoxesEnabled, SUBSCRIPTION_BOXES_FLAG } from "@/boxes/flags";
import { subscriptionsEnabled } from "@/subscriptions/flags";
import { listBoxSubscriptionsForAdmin } from "@/boxes/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin("orders.view");
  if (!auth.ok) return NextResponse.json(guardError(auth), { status: auth.status });

  const { rows, config } = await listBoxSubscriptionsForAdmin();
  const masked = rows.map(({ view, extra }) => ({
    view: { ...view, customerPhone: phoneForViewer(view.customerPhone, auth.permissions) ?? "" },
    extra,
  }));
  return NextResponse.json({
    data: { subscriptions: masked, boxVariantIds: config.boxVariantIds },
    meta: {
      flag: SUBSCRIPTION_BOXES_FLAG,
      moduleEnabled: subscriptionBoxesEnabled(),
      engineEnabled: subscriptionsEnabled(),
      generation:
        "worker-sweep — box orders are generated only when the worker host runs the subscription-generation queue; a due cycle without defined contents is skipped (BOX_CONTENTS_MISSING), never filled with the previous cycle",
    },
  });
}
