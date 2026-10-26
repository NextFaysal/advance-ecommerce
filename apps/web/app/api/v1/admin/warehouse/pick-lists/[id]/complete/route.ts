/**
 * POST /api/v1/admin/warehouse/pick-lists/[id]/complete
 * (orders.view, module.warehouse_ops)
 *
 * Marks the pick list DONE. This is a staff attestation ONLY — it
 * moves no stock and changes no order state (stock was reserved
 * when each order was created). Idempotent.
 */
import { NextResponse } from "next/server";
import { requireWarehouseAccess, warehouseErrorResponse } from "@/warehouse/guard";
import { completePickList, prismaKeyValueStore } from "@/warehouse/pick-lists";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const outcome = await requireWarehouseAccess();
  if (!outcome.ok) return outcome.response;
  try {
    const list = await completePickList(prismaKeyValueStore(), params.id, {
      id: outcome.access.userId,
      name: outcome.access.userName,
    });
    return NextResponse.json({ data: { list }, meta: { persistence: "setting-json" } });
  } catch (error) {
    return warehouseErrorResponse(error);
  }
}
