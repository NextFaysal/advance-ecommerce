/**
 * Pick lists — GET list + POST create.
 * /api/v1/admin/warehouse/pick-lists (orders.view, module.warehouse_ops)
 *
 * POST body: { orderIds: string[] } — every order must be CONFIRMED
 * and off any other OPEN pick list (src/warehouse/pick-lists.ts
 * enforces; its WarehouseError maps to the standard error shape).
 * Creating a list moves NO stock — it snapshots lines for the
 * pickers; stock was reserved at order creation.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWarehouseAccess, warehouseErrorResponse } from "@/warehouse/guard";
import { createPickList, listPickLists, prismaKeyValueStore } from "@/warehouse/pick-lists";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1).max(200),
});

export async function GET() {
  const outcome = await requireWarehouseAccess();
  if (!outcome.ok) return outcome.response;
  try {
    const lists = await listPickLists(prismaKeyValueStore());
    return NextResponse.json({ data: { lists }, meta: { persistence: "setting-json" } });
  } catch (error) {
    return warehouseErrorResponse(error);
  }
}

export async function POST(req: Request) {
  const outcome = await requireWarehouseAccess();
  if (!outcome.ok) return outcome.response;
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "অর্ডার সিলেকশন সঠিক নয়।", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const list = await createPickList(prismaKeyValueStore(), parsed.data.orderIds, {
      id: outcome.access.userId,
      name: outcome.access.userName,
    });
    return NextResponse.json({ data: { list }, meta: { persistence: "setting-json" } }, { status: 201 });
  } catch (error) {
    return warehouseErrorResponse(error);
  }
}
