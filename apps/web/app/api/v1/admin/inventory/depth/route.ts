import { NextResponse } from "next/server";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { getInventoryDepthReport } from "@/inventory/analytics";
import { isInventoryDepthEnabled } from "@/inventory/batches";
import { guardError, requireAdmin } from "@/reports/guard";
import { canSeeCostPrices, maskInventoryDepthReport } from "@/lib/cost-masking";

// Inventory depth report (ADV-20): ABC analysis + dead stock +
// expiring batches + batch overview + serial census, computed from
// real rows at read time (src/inventory/analytics.ts).
// RBAC: inventory.view. Flag: module.inventory_depth (OFF → 403).
// Cost masking (ADV-27): dead-stock unit costs + stock values are
// nulled server-side unless the caller holds
// products.edit_cost_price; meta.costMasked says so.

export async function GET(req: Request) {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireAdmin("inventory.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isInventoryDepthEnabled()) {
    return NextResponse.json(
      {
        error: {
          code: "FEATURE_LOCKED",
          message: "Inventory depth is locked for this install (module.inventory_depth is OFF).",
        },
      },
      { status: 403 },
    );
  }
  const daysParam = Number.parseInt(new URL(req.url).searchParams.get("days") ?? "", 10);
  try {
    const report = await getInventoryDepthReport(
      Number.isFinite(daysParam) && daysParam > 0 ? daysParam : undefined,
    );
    const canSeeCost = canSeeCostPrices(guard.permissions);
    return NextResponse.json({
      data: maskInventoryDepthReport(report, guard.permissions),
      meta: { persistence: "database", costMasked: !canSeeCost },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Inventory depth needs a working database." } },
      { status: 503 },
    );
  }
}
