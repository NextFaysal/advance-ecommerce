import { NextResponse } from "next/server";
import { createPurchaseOrder, purchaseOrderSchema, type PurchaseOrder } from "@/inventory/service";
import { guardError, requireAdmin } from "@/reports/guard";

// Purchase orders — stub service (Agent 10). In-memory only; receiving a PO
// must go through inventory movements (purchase_receive) once DB-wired.
// RBAC: inventory.purchase_order for both read and create.
const orders: PurchaseOrder[] = [];

export async function GET() {
  const guard = await requireAdmin("inventory.purchase_order");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  return NextResponse.json({ data: { purchaseOrders: orders }, meta: { persistence: "in-memory-stub" } });
}
export async function POST(req: Request) {
  const guard = await requireAdmin("inventory.purchase_order");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = purchaseOrderSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Invalid purchase order.", details: parsed.error.issues } }, { status: 400 });
  const po = createPurchaseOrder(parsed.data);
  orders.push(po);
  return NextResponse.json({ data: { purchaseOrder: po }, meta: { persistence: "in-memory-stub" } }, { status: 201 });
}
