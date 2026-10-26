/**
 * GET /api/v1/admin/warehouse/pick-lists/[id] (orders.view,
 * module.warehouse_ops) — one pick list with its grouped lines and
 * per-order pack checklists.
 */
import { NextResponse } from "next/server";
import { requireWarehouseAccess, warehouseErrorResponse } from "@/warehouse/guard";
import { WarehouseError, getPickList, prismaKeyValueStore } from "@/warehouse/pick-lists";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const outcome = await requireWarehouseAccess();
  if (!outcome.ok) return outcome.response;
  try {
    const list = await getPickList(prismaKeyValueStore(), params.id);
    if (!list) {
      throw new WarehouseError("PICK_LIST_NOT_FOUND", "পিক লিস্ট পাওয়া যায়নি।", 404);
    }
    return NextResponse.json({ data: { list }, meta: { persistence: "setting-json" } });
  } catch (error) {
    return warehouseErrorResponse(error);
  }
}
