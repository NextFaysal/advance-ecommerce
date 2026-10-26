import { NextResponse } from "next/server";
import { isInventoryDepthEnabled } from "@/inventory/batches";
import { runAutoReorder } from "@/inventory/reorder";
import { writeAudit } from "@/lib/audit";
import { guardError, requireAdmin } from "@/reports/guard";

// Auto-reorder trigger (ADV-20): runs the reorder engine once and
// creates DRAFT purchase orders for variants at/below their reorder
// point (src/inventory/reorder.ts). Drafts only — nothing is ever
// sent to a supplier from here. The same runAutoReorder() is what a
// future worker tick will call.
// RBAC: inventory.purchase_order. Flag: module.inventory_depth.

export async function POST() {
  const guard = await requireAdmin("inventory.purchase_order");
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
  try {
    const result = await runAutoReorder(guard.userId);
    await writeAudit({
      actorId: guard.userId,
      action: "inventory.reorder.run",
      entityType: "PurchaseOrder",
      afterJson: {
        consideredCount: result.consideredCount,
        createdPoIds: result.createdPos.map((p) => p.purchaseOrderId),
        createdLineCount: result.createdPos.reduce((s, p) => s + p.lines.length, 0),
        skipped: result.skipped.map((s) => ({ variantId: s.variantId, reason: s.reason })),
      },
    });
    return NextResponse.json({ data: result, meta: { persistence: "database" } });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Auto-reorder needs a working database." } },
      { status: 503 },
    );
  }
}
