import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { bumpPortalTokenVersion } from "@/lib/portal-token-versions";
import { requireVendorAdmin, vendorGuardError } from "../guard";

// Revoke ALL vendor portal sessions — doc 23 wave 54-7.
// POST (vendors.manage): increments the vendor portal's token
// version in the `portal.token_versions` Setting document
// (src/lib/portal-token-versions.ts). Every outstanding
// vendor_session token — including tokens issued before the
// version mechanism existed — fails verification from its next
// request on; vendors simply log in again (phone + OTP). A reason
// is REQUIRED (emergency action, audited as
// vendors.sessions.revoke_all). Honest scope: tokens are
// stateless, so there is no live session list and no exact count
// of killed sessions — the response reports the version bump,
// never an invented session count.
function dbNotReady() {
  return NextResponse.json(
    { error: { code: "DB_NOT_READY", message: "Vendor database is not available." } },
    { status: 503 },
  );
}

const bodySchema = z.object({
  reason: z.string().trim().min(1, "A reason is required.").max(500),
});

export async function POST(req: Request) {
  const guard = await requireVendorAdmin("vendors.manage");
  if (!guard.ok) return NextResponse.json(vendorGuardError(guard), { status: guard.status });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "A reason is required to revoke all vendor sessions.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const { previous, current } = await bumpPortalTokenVersion("vendor", guard.userId);
    await writeAudit({
      actorId: guard.userId,
      action: "vendors.sessions.revoke_all",
      entityType: "Portal",
      entityId: "vendor",
      beforeJson: { tokenVersion: previous },
      afterJson: { tokenVersion: current },
      reason: parsed.data.reason,
    });
    return NextResponse.json({
      data: { portal: "vendor", previousVersion: previous, currentVersion: current },
      meta: {
        persistence: "database",
        note: "All outstanding vendor portal sessions are invalid from their next request; vendors must log in again. Stateless tokens have no live session list, so no session count is reported.",
      },
    });
  } catch {
    return dbNotReady();
  }
}
