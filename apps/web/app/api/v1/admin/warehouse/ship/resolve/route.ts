/**
 * GET /api/v1/admin/warehouse/ship/resolve?code=…
 * (orders.view, module.warehouse_ops)
 *
 * Resolves a scanned tracking code / shipment id / order number to
 * its shipment + packed state (src/warehouse/ship-scan.ts). An
 * unbooked order number resolves successfully as "not_booked" with
 * the order-workspace path — booking itself is never duplicated
 * here.
 */
import { NextResponse } from "next/server";
import { requireWarehouseAccess, warehouseErrorResponse } from "@/warehouse/guard";
import { resolveScanCode } from "@/warehouse/ship-scan";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const outcome = await requireWarehouseAccess();
  if (!outcome.ok) return outcome.response;
  const code = new URL(req.url).searchParams.get("code") ?? "";
  try {
    const resolution = await resolveScanCode(code);
    return NextResponse.json({ data: resolution, meta: { persistence: "database" } });
  } catch (error) {
    return warehouseErrorResponse(error);
  }
}
