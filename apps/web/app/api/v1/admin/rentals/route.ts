/**
 * Rentals board read — GET /api/v1/admin/rentals
 * (ADV-23 vertical 3, wave 56).
 *
 * Guard: admin session + orders.view, then the module.rental flag
 * (403 FEATURE_LOCKED when OFF — src/rental/guard.ts). Returns the
 * live rentals (stored ACTIVE + OVERDUE) ordered by return date,
 * joined with each order's number + status; customers appear as
 * first name + masked phone only. OVERDUE is also a computed
 * display state: an ACTIVE rental past its endDate reads overdue
 * here even before anyone marks it — there is no cron flipping
 * rows. The board page polls this route every 30s — it is a
 * polling read, not realtime, and the board UI says so.
 */
import { NextResponse } from "next/server";
import { requireRentalAccess } from "@/rental/guard";
import { getRentalsBoard } from "@/rental/bookings";

export const dynamic = "force-dynamic";

export async function GET() {
  const outcome = await requireRentalAccess("orders.view");
  if (!outcome.ok) return outcome.response;

  try {
    const board = await getRentalsBoard();
    return NextResponse.json({ data: board, meta: { persistence: "database" } });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Rentals board needs a working database connection." } },
      { status: 503 },
    );
  }
}
