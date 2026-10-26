/**
 * PUT /api/v1/admin/team/digest/recipients (staff.manage)
 *
 * Replace the daily-digest recipient list (Setting doc
 * team.digest.recipients). Emails are validated, lowercased and
 * deduped server-side; an empty list is allowed (digest sends then
 * honestly report no_recipients).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { setDigestRecipients } from "@/team/digest";
import { requireTeamPermission, teamErrorResponse } from "@/team/guard";

export const dynamic = "force-dynamic";

const putSchema = z.object({
  emails: z.array(z.string().trim().min(3).max(200)).max(50),
});

export async function PUT(req: Request) {
  const guard = await requireTeamPermission("staff.manage");
  if (!guard.ok) return guard.response;
  try {
    const parsed = putSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: "emails must be an array of addresses.", details: parsed.error.issues } },
        { status: 400 },
      );
    }
    try {
      const emails = await setDigestRecipients(parsed.data.emails, guard.user.id);
      return NextResponse.json({ data: { emails }, meta: { persistence: "database" } });
    } catch {
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: "এক বা একাধিক ইমেইল ঠিকানা সঠিক নয়। / One or more email addresses are invalid." } },
        { status: 400 },
      );
    }
  } catch (error) {
    return teamErrorResponse(error);
  }
}
