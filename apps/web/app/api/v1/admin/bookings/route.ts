/**
 * Bookings board read — GET /api/v1/admin/bookings?date=yyyy-mm-dd
 * (ADV-23, wave 56).
 *
 * Guard: admin session + orders.view, then the module.services
 * flag (403 FEATURE_LOCKED when OFF — src/services/guard.ts).
 * Returns one Dhaka day's bookings grouped by slot, joined with
 * each order's number + status; customers appear as first name +
 * masked phone only. `date` defaults to today (Asia/Dhaka). The
 * board page polls this route every 30s — it is a polling read,
 * not realtime, and the board UI says so.
 */
import { NextResponse } from "next/server";
import { isValidYmd, todayDhakaYmd } from "@/lib/dhaka-date";
import { requireServicesAccess } from "@/services/guard";
import { getBookingsBoard } from "@/services/bookings";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const outcome = await requireServicesAccess("orders.view");
  if (!outcome.ok) return outcome.response;

  const url = new URL(req.url);
  const date = url.searchParams.get("date")?.trim() || todayDhakaYmd();
  if (!isValidYmd(date)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "date must be a valid yyyy-mm-dd day." } },
      { status: 400 },
    );
  }
  try {
    const board = await getBookingsBoard(date);
    return NextResponse.json({ data: board, meta: { persistence: "database" } });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Bookings board needs a working database connection." } },
      { status: 503 },
    );
  }
}
