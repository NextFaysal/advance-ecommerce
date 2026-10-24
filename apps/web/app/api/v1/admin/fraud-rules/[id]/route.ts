import { NextResponse } from "next/server";
import { featureGuardError, requireFeatureAdmin } from "@/automation/guard";
import { demoFraudListStore } from "@/fraud/lists";

// Remove one blacklist / whitelist entry by id — Agent 13.
// A remove should carry a reason in the admin UI flow and be audit-logged
// (writeAudit via the API owner once list management is DB-backed); the
// in-memory demo store has no audit sink yet, noted in meta.

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireFeatureAdmin("module.fraud_scoring", "fraud.manage");
  if (!guard.ok) return NextResponse.json(featureGuardError(guard), { status: guard.status });
  const removed = demoFraudListStore.remove(params.id);
  if (!removed) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "List entry not found." } }, { status: 404 });
  }
  return NextResponse.json({
    data: { deleted: true },
    meta: { persistence: "in-memory-demo", audit: "pending-db-wiring" },
  });
}
