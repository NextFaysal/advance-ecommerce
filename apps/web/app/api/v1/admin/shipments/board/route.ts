/**
 * Shipments board read — doc 21 W0-C (G3-7a).
 * GET /api/v1/admin/shipments/board (shipments.view)
 *
 * Cross-order read of REAL Shipment rows (src/shipments/board.ts) for
 * the /admin/shipments board, which previously rendered page-state
 * demo records. Read-only by design: booking and status actions live
 * in the order workspace (its shipments panel); this route exists so
 * API consumers get the same board the page renders server-side.
 */
import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/integrations/sandbox/admin-auth";
import { getShipmentsBoard } from "@/shipments/board";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAdminPermission("shipments.view");
  if (!guard.ok) {
    return NextResponse.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.httpStatus },
    );
  }
  const data = await getShipmentsBoard();
  return NextResponse.json({ data, meta: { persistence: "database" } });
}
