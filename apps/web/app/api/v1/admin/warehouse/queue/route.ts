/**
 * GET /api/v1/admin/warehouse/queue (orders.view, module.warehouse_ops)
 *
 * The pick queue: CONFIRMED orders oldest-first, decorated with
 * open-pick-list and packed-marker state, plus the ids confirmed
 * today (Dhaka) for the "আজকের সব কনফার্মড" pick-list shortcut.
 * Read model: src/warehouse/queue.ts.
 */
import { NextResponse } from "next/server";
import { requireWarehouseAccess, warehouseErrorResponse } from "@/warehouse/guard";
import { getConfirmedQueue } from "@/warehouse/queue";

export const dynamic = "force-dynamic";

export async function GET() {
  const outcome = await requireWarehouseAccess();
  if (!outcome.ok) return outcome.response;
  try {
    const queue = await getConfirmedQueue();
    return NextResponse.json({ data: queue, meta: { persistence: "database" } });
  } catch (error) {
    return warehouseErrorResponse(error);
  }
}
