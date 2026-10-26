/**
 * POST /api/v1/admin/warehouse/ship/handover
 * (orders.view, module.warehouse_ops)
 *
 * Body: { shipmentId } — record that the parcel was handed to the
 * courier. This writes ONE order timeline note labelled
 * "কুরিয়ারে হস্তান্তর (ম্যানুয়াল)" and nothing more: it is a staff
 * attestation, NOT a courier provider event, so the courier event
 * funnel is deliberately not fed (src/warehouse/ship-scan.ts).
 * Idempotent — a second call reports alreadyRecorded.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWarehouseAccess, warehouseErrorResponse } from "@/warehouse/guard";
import { recordManualHandover } from "@/warehouse/ship-scan";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ shipmentId: z.string().min(1) });

export async function POST(req: Request) {
  const outcome = await requireWarehouseAccess();
  if (!outcome.ok) return outcome.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "শিপমেন্ট আইডি দিন।", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const result = await recordManualHandover(parsed.data.shipmentId, {
      id: outcome.access.userId,
      name: outcome.access.userName,
    });
    return NextResponse.json({ data: result, meta: { persistence: "database" } });
  } catch (error) {
    return warehouseErrorResponse(error);
  }
}
