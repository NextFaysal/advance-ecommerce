/**
 * GET /api/v1/admin/boxes/variants?q=<text> — real-variant search
 * for the box contents editor's item rows (ADV-23 vertical 4).
 * Guarded by settings.view (it serves the settings-guarded
 * contents editor). Matches SKU or product title (Bangla/English),
 * returns at most 20 live variants; a query under 2 chars returns
 * an empty list — the editor always searches, it never dumps the
 * catalog.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError } from "@/lib/rbac";
import { searchVariantsForContents } from "@/boxes/service";

export const dynamic = "force-dynamic";

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: Request) {
  const token = cookies().get("admin_session")?.value;
  if (!token) return err("UNAUTHENTICATED", "Admin login required.", 401);
  try {
    const session = await validateSessionToken(token);
    if (!session) return err("UNAUTHENTICATED", "Session expired or revoked.", 401);
    requirePermission(session.user.permissions, "settings.view");
  } catch (e) {
    if (e instanceof RbacError) return err("FORBIDDEN", e.message, 403);
    return err("DB_NOT_READY", "Session check needs a working database.", 503);
  }

  const q = new URL(req.url).searchParams.get("q") ?? "";
  const variants = await searchVariantsForContents(q);
  return NextResponse.json({ data: { variants }, meta: { persistence: "prisma" } });
}
