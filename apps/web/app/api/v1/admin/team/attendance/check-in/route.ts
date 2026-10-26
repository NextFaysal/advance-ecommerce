/**
 * POST /api/v1/admin/team/attendance/check-in (any signed-in staff)
 *
 * Checks the SESSION user in. If an entry is already open (today, or
 * an overnight session from yesterday) that same entry is returned
 * with meta.alreadyOpen=true — a duplicate row is never created.
 */
import { NextResponse } from "next/server";
import { checkIn } from "@/team/attendance";
import { requireTeamSession, teamErrorResponse } from "@/team/guard";

export const dynamic = "force-dynamic";

export async function POST() {
  const guard = await requireTeamSession();
  if (!guard.ok) return guard.response;
  try {
    const result = await checkIn(guard.user.id);
    return NextResponse.json({
      data: { entry: result.entry },
      meta: {
        persistence: "database",
        alreadyOpen: result.alreadyOpen,
        ...(result.alreadyOpen
          ? { note: "ইতিমধ্যে চেক-ইন খোলা আছে — একই এন্ট্রি ফেরত দেওয়া হয়েছে, নতুন ডুপ্লিকেট তৈরি হয়নি।" }
          : {}),
      },
    });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
