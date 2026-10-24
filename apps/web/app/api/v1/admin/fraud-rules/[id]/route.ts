import { NextResponse } from "next/server";
import { featureGuardError, requireFeatureAdmin } from "@/automation/guard";
import { fraudListStore } from "@/fraud/lists";

// Remove one blacklist / whitelist entry by id — Agent 13.
// List management is DB-backed (fraudListStore); a remove should still
// carry a reason in the admin UI flow and be audit-logged (writeAudit
// via the API owner) — that audit hook is not wired yet, noted in meta.

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireFeatureAdmin("module.fraud_scoring", "fraud.manage");
  if (!guard.ok) return NextResponse.json(featureGuardError(guard), { status: guard.status });
  const removed = await fraudListStore.remove(params.id);
  if (!removed) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "List entry not found." } }, { status: 404 });
  }
  return NextResponse.json({
    data: { deleted: true },
    meta: { persistence: "database", audit: "pending-db-wiring" },
  });
}
