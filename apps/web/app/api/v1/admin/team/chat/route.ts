/**
 * Team chat (ADV-27 remainder, doc 23 wave 53-3) — one general room.
 *
 * GET  /api/v1/admin/team/chat (any signed-in staff)
 *   -> the latest 100 messages + the caller's identity (so the panel
 *      can mark own messages). DB-backed (Setting docs), so chat
 *      works even when Redis is down.
 * POST /api/v1/admin/team/chat (any signed-in staff)
 *   -> append a message. Body { body: string, 1-1000 chars }.
 *      The author is ALWAYS the session user — a userId/userName in
 *      the payload is ignored by design (the schema strips it).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { CHAT_BODY_MAX, listLatestMessages, postChatMessage } from "@/team/chat";
import { requireTeamSession, teamErrorResponse } from "@/team/guard";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  body: z.string().trim().min(1).max(CHAT_BODY_MAX),
});

export async function GET() {
  const guard = await requireTeamSession();
  if (!guard.ok) return guard.response;
  try {
    const messages = await listLatestMessages(100);
    return NextResponse.json({
      data: {
        me: { id: guard.user.id, name: guard.user.name ?? "" },
        messages,
      },
      meta: { persistence: "database" },
    });
  } catch (error) {
    return teamErrorResponse(error);
  }
}

export async function POST(req: Request) {
  const guard = await requireTeamSession();
  if (!guard.ok) return guard.response;
  try {
    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: `Message body must be 1-${CHAT_BODY_MAX} characters.`,
          },
        },
        { status: 400 },
      );
    }
    const message = await postChatMessage(
      {
        id: guard.user.id,
        name: guard.user.name?.trim() || guard.user.email || "",
      },
      parsed.data.body,
    );
    return NextResponse.json({
      data: { message },
      meta: { persistence: "database" },
    });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
