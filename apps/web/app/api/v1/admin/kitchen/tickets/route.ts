/**
 * KDS board read — GET /api/v1/admin/kitchen/tickets (ADV-23, wave 56).
 *
 * Guard: admin session + orders.view, then the module.restaurant
 * flag (403 FEATURE_LOCKED when OFF — src/restaurant/guard.ts).
 * Returns the live kitchen queue (QUEUED / PREPARING / READY, oldest
 * first) joined with each order's number + item lines, plus the
 * Asia/Dhaka-day SERVED / CANCELLED counts. The board page polls
 * this route every 15s — it is a polling read, not realtime, and
 * the board UI says so.
 */
import { NextResponse } from "next/server";
import { requireRestaurantAccess } from "@/restaurant/guard";
import { getKitchenBoard } from "@/restaurant/tickets";

export const dynamic = "force-dynamic";

export async function GET() {
  const outcome = await requireRestaurantAccess("orders.view");
  if (!outcome.ok) return outcome.response;
  try {
    const board = await getKitchenBoard();
    return NextResponse.json({ data: board, meta: { persistence: "database" } });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Kitchen board needs a working database connection." } },
      { status: 503 },
    );
  }
}
