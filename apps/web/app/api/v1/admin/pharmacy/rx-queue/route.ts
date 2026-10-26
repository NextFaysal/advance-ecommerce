/**
 * Pharmacist verification queue — ADV-22 (doc 22).
 *
 * GET /api/v1/admin/pharmacy/rx-queue — orders waiting for a
 * prescription decision (latest rx state PENDING), oldest first,
 * each with its recorded prescription + Rx line items.
 *
 * Guard: orders.view (the queue is order work — the call-center /
 * warehouse precedent) + the pharmacy pack flag.
 */
import { NextResponse } from "next/server";
import { pharmacyGuard } from "../guard";
import { listRxQueue } from "@/business-modules/pharmacy-orders";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await pharmacyGuard("orders.view");
  if ("error" in auth) return auth.error;
  const queue = await listRxQueue();
  return NextResponse.json({ data: { queue }, meta: { persistence: "database" } });
}
