import { NextResponse } from "next/server";
import { featureGuardError, requireFeatureAdmin } from "@/automation/guard";
import { fraudListStore } from "@/fraud/lists";
import { writeAudit } from "@/lib/audit";

// Remove one blacklist / whitelist entry by id — Agent 13.
// Audit-logged: every fraud list removal is written to the AuditLog table
// (action "fraud.list_entry.remove", entityType "FraudListEntry") so the
// admin audit trail captures who removed which entry and when.

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireFeatureAdmin("module.fraud_scoring", "fraud.manage");
  if (!guard.ok) return NextResponse.json(featureGuardError(guard), { status: guard.status });
  const removed = await fraudListStore.remove(params.id);
  if (!removed) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "List entry not found." } }, { status: 404 });
  }
  await writeAudit({
    actorId: guard.userId,
    action: "fraud.list_entry.remove",
    entityType: "FraudListEntry",
    entityId: params.id,
    beforeJson: { id: params.id },
    afterJson: null,
  });
  return NextResponse.json({
    data: { deleted: true },
    meta: { persistence: "database", audit: "written" },
  });
}
