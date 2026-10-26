import { NextResponse } from "next/server";
import { purchaseOrderSchema } from "@/inventory/service";
import { createPurchaseOrderDb, listPurchaseOrdersDb } from "@/inventory/repository";
import { guardError, requireAdmin } from "@/reports/guard";
import { canSeeCostPrices, maskPurchaseOrder } from "@/lib/cost-masking";

// Purchase orders — DB-backed (PurchaseOrder + PurchaseOrderItem +
// Supplier tables, src/inventory/repository.ts). Receiving a PO still
// goes through inventory movements (purchase_receive) — creating the
// PO itself moves no stock.
// RBAC: inventory.purchase_order for both read and create.
// Cost masking (ADV-27): a PO is a cost document — unit costs and
// the PO total are nulled server-side (meta.costMasked) unless the
// caller holds products.edit_cost_price; the POST response masks the
// same way (a creator without the permission reads back nulls, the
// stored row keeps the submitted values).

export async function GET() {
  const guard = await requireAdmin("inventory.purchase_order");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  try {
    const purchaseOrders = await listPurchaseOrdersDb();
    const canSeeCost = canSeeCostPrices(guard.permissions);
    return NextResponse.json({
      data: { purchaseOrders: purchaseOrders.map((po) => maskPurchaseOrder(po, guard.permissions)) },
      meta: { persistence: "database", costMasked: !canSeeCost },
    });
  } catch {
    return NextResponse.json({ error: { code: "DB_NOT_READY", message: "Purchase orders need a working database." } }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin("inventory.purchase_order");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = purchaseOrderSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Invalid purchase order.", details: parsed.error.issues } }, { status: 400 });
  try {
    const purchaseOrder = await createPurchaseOrderDb(parsed.data);
    return NextResponse.json(
      {
        data: { purchaseOrder: maskPurchaseOrder(purchaseOrder, guard.permissions) },
        meta: { persistence: "database", costMasked: !canSeeCostPrices(guard.permissions) },
      },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof Error && (e.message.startsWith("warehouse_not_found") || e.message.startsWith("variant_not_found"))) {
      return NextResponse.json({ error: { code: "INVALID_REFERENCE", message: e.message } }, { status: 422 });
    }
    return NextResponse.json({ error: { code: "DB_NOT_READY", message: "Purchase orders need a working database." } }, { status: 503 });
  }
}
