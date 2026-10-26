/**
 * /api/v1/admin/team/digest
 *   GET  (staff.view)   — ?date=yyyy-mm-dd (default today, Dhaka):
 *                         the digest data + rendered bn/en text +
 *                         the configured recipients.
 *   POST (staff.manage) — {date?}: build + enqueue the digest email
 *                         to every recipient. The response meta says
 *                         queued / not_queued per recipient —
 *                         queued is NOT sent (no worker runs in
 *                         production yet; see src/team/digest.ts).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { ymdSchema } from "@/team/docs";
import {
  buildDailyDigest,
  getDigestRecipients,
  renderDigestText,
  sendDailyDigest,
} from "@/team/digest";
import { requireTeamPermission, teamErrorResponse } from "@/team/guard";
import { isValidYmd, todayDhakaYmd } from "@/lib/dhaka-date";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await requireTeamPermission("staff.view");
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get("date") ?? todayDhakaYmd();
    if (!isValidYmd(date)) {
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: "date must be yyyy-mm-dd." } },
        { status: 400 },
      );
    }
    const [digest, recipients] = await Promise.all([buildDailyDigest(date), getDigestRecipients()]);
    return NextResponse.json({
      data: {
        digest,
        textBn: renderDigestText(digest, "bn"),
        textEn: renderDigestText(digest, "en"),
        recipients,
      },
      meta: { persistence: "database" },
    });
  } catch (error) {
    return teamErrorResponse(error);
  }
}

const postSchema = z.object({ date: ymdSchema.optional() });

export async function POST(req: Request) {
  const guard = await requireTeamPermission("staff.manage");
  if (!guard.ok) return guard.response;
  try {
    const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: "date must be yyyy-mm-dd.", details: parsed.error.issues } },
        { status: 400 },
      );
    }
    const date = parsed.data.date ?? todayDhakaYmd();
    const result = await sendDailyDigest(date, guard.user.id);
    return NextResponse.json({
      data: result,
      meta: {
        persistence: "database",
        delivery: result.delivery,
        note: "queued মানে শুধু Redis-এ জমা হয়েছে — পাঠানো হয়নি। Worker + email transport ছাড়া ডেলিভারি হবে না।",
      },
    });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
