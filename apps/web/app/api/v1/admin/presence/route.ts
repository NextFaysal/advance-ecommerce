/**
 * Staff presence (ADV-27 remainder, doc 23 wave 53-4).
 *
 * POST /api/v1/admin/presence (any signed-in staff)
 *   Heartbeat: { path } — records the SESSION user as present on
 *   that admin path for PRESENCE_TTL_SECONDS (75s). Clients send it
 *   every 30s. Identity comes from the session, never the payload.
 * GET  /api/v1/admin/presence?path=/admin/orders/<id> (signed-in staff)
 *   -> { me, online, onPath }: `online` = every fresh presence entry
 *      (including the caller); `onPath` = fresh entries on exactly
 *      `path`, EXCLUDING the caller — i.e. "who else is here", which
 *      is what the edit-conflict warning renders. Without ?path,
 *      onPath is [].
 *
 * Presence is advisory only — nothing here locks or blocks editing.
 * When Redis is unavailable the service degrades silently (empty or
 * per-instance results), never an error response.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { PRESENCE_TTL_SECONDS, listPresence, recordPresence } from "@/team/presence";
import { requireTeamSession, teamErrorResponse } from "@/team/guard";

export const dynamic = "force-dynamic";

const pathSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((p) => p.startsWith("/admin"), { message: "path must be an admin path" });

const postSchema = z.object({ path: pathSchema });

export async function POST(req: Request) {
  const guard = await requireTeamSession();
  if (!guard.ok) return guard.response;
  try {
    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: "path must be an admin path (max 200 chars)." } },
        { status: 400 },
      );
    }
    await recordPresence({
      userId: guard.user.id,
      name: guard.user.name?.trim() || guard.user.email || "",
      path: parsed.data.path,
    });
    return NextResponse.json({
      data: { ok: true },
      meta: { ttlSeconds: PRESENCE_TTL_SECONDS },
    });
  } catch (error) {
    return teamErrorResponse(error);
  }
}

export async function GET(req: Request) {
  const guard = await requireTeamSession();
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(req.url);
    const pathParam = url.searchParams.get("path");
    let path: string | undefined;
    if (pathParam !== null) {
      const parsed = pathSchema.safeParse(pathParam);
      if (!parsed.success) {
        return NextResponse.json(
          { error: { code: "INVALID_INPUT", message: "path must be an admin path (max 200 chars)." } },
          { status: 400 },
        );
      }
      path = parsed.data;
    }
    const online = await listPresence();
    const onPath =
      path === undefined
        ? []
        : online.filter((e) => e.path === path && e.userId !== guard.user.id);
    return NextResponse.json({
      data: { me: guard.user.id, online, onPath },
      meta: { ttlSeconds: PRESENCE_TTL_SECONDS },
    });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
