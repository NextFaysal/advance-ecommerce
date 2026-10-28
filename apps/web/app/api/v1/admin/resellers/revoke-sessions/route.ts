import { NextResponse } from "next/server";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { bumpPortalTokenVersion } from "@/lib/portal-token-versions";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoResellerFlags, isResellerEnabled } from "@/reseller/flags";

// Revoke ALL reseller portal sessions — doc 23 wave 54-7.
// POST (resellers.manage): increments the reseller portal's token
// version in the `portal.token_versions` Setting document
// (src/lib/portal-token-versions.ts). Every outstanding
// reseller_session token — including tokens issued before the
// version mechanism existed — fails verification from its next
// request on; resellers simply log in again. A reason is REQUIRED
// (emergency action, audited as resellers.sessions.revoke_all).
// Honest scope: tokens are stateless, so there is no live session
// list and no exact count of killed sessions — the response reports
// the version bump, never an invented session count.
function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "Reseller module is locked for this install (module.reseller is OFF)." } },
    { status: 403 },
  );
}

function dbNotReady() {
  return NextResponse.json(
    { error: { code: "DB_NOT_READY", message: "Reseller database is not available." } },
    { status: 503 },
  );
}

const bodySchema = z.object({
  reason: z.string().trim().min(1, "A reason is required.").max(500),
});

export async function POST(req: Request) {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireAdmin("resellers.manage");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isResellerEnabled(demoResellerFlags)) return locked();
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "A reason is required to revoke all reseller sessions.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const { previous, current } = await bumpPortalTokenVersion("reseller", guard.userId);
    await writeAudit({
      actorId: guard.userId,
      action: "resellers.sessions.revoke_all",
      entityType: "Portal",
      entityId: "reseller",
      beforeJson: { tokenVersion: previous },
      afterJson: { tokenVersion: current },
      reason: parsed.data.reason,
    });
    return NextResponse.json({
      data: { portal: "reseller", previousVersion: previous, currentVersion: current },
      meta: {
        persistence: "database",
        note: "All outstanding reseller portal sessions are invalid from their next request; resellers must log in again. Stateless tokens have no live session list, so no session count is reported.",
      },
    });
  } catch {
    return dbNotReady();
  }
}
