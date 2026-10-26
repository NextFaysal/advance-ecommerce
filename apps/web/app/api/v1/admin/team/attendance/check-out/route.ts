/**
 * POST /api/v1/admin/team/attendance/check-out (any signed-in staff)
 *
 * Closes the SESSION user's open entry. No open entry → 409
 * NO_OPEN_ENTRY (never a silent no-op).
 */
import { NextResponse } from "next/server";
import { checkOut, entryMinutes } from "@/team/attendance";
import { requireTeamSession, teamErrorResponse } from "@/team/guard";

export const dynamic = "force-dynamic";

export async function POST() {
  const guard = await requireTeamSession();
  if (!guard.ok) return guard.response;
  try {
    const entry = await checkOut(guard.user.id);
    return NextResponse.json({
      data: { entry, minutes: entryMinutes(entry) },
      meta: { persistence: "database" },
    });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
