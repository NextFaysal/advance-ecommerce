/**
 * GET /api/v1/admin/team/attendance/me (any signed-in staff)
 *
 * The caller's own attendance state for the dashboard card: today's
 * state (not_checked_in | checked_in | done), today's entries +
 * minutes, the open entry if any, and this month's summary.
 */
import { NextResponse } from "next/server";
import { getMyAttendance } from "@/team/attendance";
import { requireTeamSession, teamErrorResponse } from "@/team/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireTeamSession();
  if (!guard.ok) return guard.response;
  try {
    const mine = await getMyAttendance(guard.user.id);
    return NextResponse.json({
      data: { user: { id: guard.user.id, name: guard.user.name ?? "" }, ...mine },
      meta: { persistence: "database" },
    });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
