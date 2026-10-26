/**
 * GET /api/v1/admin/team/attendance?month=yyyy-mm (staff.view)
 *
 * The month grid: the staff directory plus, per staff member, present
 * days / total minutes / open sessions and a per-day breakdown
 * (sessions, minutes, open flag, shift names). Staff with no entries
 * appear with an empty summary — the grid never hides a team member.
 */
import { NextResponse } from "next/server";
import { getMonthEntries, summarizeMonth } from "@/team/attendance";
import { daysInMonth, listTeamStaff, monthSchema } from "@/team/docs";
import { todayDhakaYmd } from "@/lib/dhaka-date";
import { requireTeamPermission, teamErrorResponse } from "@/team/guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await requireTeamPermission("staff.view");
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(req.url);
    const monthParam = url.searchParams.get("month") ?? todayDhakaYmd().slice(0, 7);
    const monthParsed = monthSchema.safeParse(monthParam);
    if (!monthParsed.success) {
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: "month must be yyyy-mm." } },
        { status: 400 },
      );
    }
    const month = monthParsed.data;
    const [staff, entries] = await Promise.all([listTeamStaff(), getMonthEntries(month)]);
    const summaries = summarizeMonth(entries, month);
    const byUser = new Map(summaries.map((s) => [s.userId, s]));
    return NextResponse.json({
      data: {
        month,
        daysInMonth: daysInMonth(month),
        staff,
        summaries: staff.map(
          (member) =>
            byUser.get(member.id) ?? {
              userId: member.id,
              presentDays: 0,
              totalMinutes: 0,
              openSessions: 0,
              days: {},
            },
        ),
      },
      meta: { persistence: "database" },
    });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
