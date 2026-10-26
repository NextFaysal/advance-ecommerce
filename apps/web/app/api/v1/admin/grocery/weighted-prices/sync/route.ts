/**
 * POST /api/v1/admin/grocery/weighted-prices/sync — ADV-22 (doc 22).
 *
 * The weighted-pricing sync action: for every variant configured in
 * the grocery pack's weightedVariants, compute the derived pack price
 * (per-kg rate × pack grams, the pack's integer priceForWeight) and
 * write it onto the variant's recorded pricePoisha — the price
 * checkout actually charges. Only diverged rows are written; the
 * report names every change (from → to) and the audit row records
 * the run. Guard: settings.integrations (a modules action, like the
 * modules catalogue route). Deliberately NOT flag-gated: staff may
 * prepare prices before the pack is enabled.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { syncWeightedPrices } from "@/business-modules/grocery-pricing";

export const dynamic = "force-dynamic";

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST() {
  const token = cookies().get("admin_session")?.value;
  if (!token) return err("UNAUTHENTICATED", "Admin login required.", 401);
  let session;
  try {
    session = await validateSessionToken(token);
    if (!session) return err("UNAUTHENTICATED", "Session expired or revoked.", 401);
    requirePermission(session.user.permissions, "settings.integrations");
  } catch (e) {
    if (e instanceof RbacError) return err("FORBIDDEN", e.message, 403);
    throw e;
  }
  const report = await syncWeightedPrices();
  await writeAudit({
    actorId: session.user.id,
    action: "grocery.weighted_price_sync",
    entityType: "ProductVariant",
    entityId: "weighted-variants",
    afterJson: {
      checked: report.checked,
      updatedCount: report.updated.length,
      updated: report.updated,
      missingVariantIds: report.missingVariantIds,
    },
  });
  return NextResponse.json({ data: report, meta: { persistence: "database" } });
}
