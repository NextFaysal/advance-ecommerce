import { NextResponse } from "next/server";
import { getPurchaseReceiveDetailDb } from "@/inventory/purchase-receive";
import { guardError, requireAdmin } from "@/reports/guard";

// Purchase order receive detail — ADV-11b (doc 22): per-line
// ordered / received / remaining, the warehouse the next receive
// would book into, and the receive history (the PURCHASE_RECEIVE
// movements booked against this PO). RBAC: inventory.purchase_order,
// the same key as the PO list/create routes.

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("inventory.purchase_order");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  try {
    const detail = await getPurchaseReceiveDetailDb(params.id);
    if (!detail) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Purchase order not found." } },
        { status: 404 },
      );
    }
    return NextResponse.json({ data: { purchaseOrder: detail }, meta: { persistence: "database" } });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Purchase orders need a working database." } },
      { status: 503 },
    );
  }
}
