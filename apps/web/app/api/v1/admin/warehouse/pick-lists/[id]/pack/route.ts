/**
 * POST /api/v1/admin/warehouse/pick-lists/[id]/pack
 * (orders.view, module.warehouse_ops)
 *
 * Body: { orderId, orderItemId, packed } — tick/untick one line of
 * one order's pack checklist. Ticks are attestations on the pick
 * list document. The tick that completes an order writes the
 * pack-completion timeline note on that order (exactly once — see
 * src/warehouse/pick-lists.ts setPackItem) and the response says so
 * via orderPackCompleted.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWarehouseAccess, warehouseErrorResponse } from "@/warehouse/guard";
import { prismaKeyValueStore, setPackItem } from "@/warehouse/pick-lists";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  orderId: z.string().min(1),
  orderItemId: z.string().min(1),
  packed: z.boolean(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const outcome = await requireWarehouseAccess();
  if (!outcome.ok) return outcome.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "প্যাক টিকের ডেটা সঠিক নয়।", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const result = await setPackItem(
      prismaKeyValueStore(),
      params.id,
      parsed.data.orderId,
      parsed.data.orderItemId,
      parsed.data.packed,
      { id: outcome.access.userId, name: outcome.access.userName },
    );
    return NextResponse.json({
      data: { list: result.list, orderPackCompleted: result.orderPackCompleted },
      meta: { persistence: "setting-json" },
    });
  } catch (error) {
    return warehouseErrorResponse(error);
  }
}
