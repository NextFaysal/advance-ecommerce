import { NextResponse } from "next/server";
import { demoFeatureFlags } from "@/automation/flags";
import { featureGuardError, requireFeatureAdmin } from "@/automation/guard";
import { automationStore } from "@/automation/store";
import { createRuleSchema, type AutomationRule } from "@/automation/types";

// Automation rules — Agent 13, Step 43 (A1).
// Module is a paid add-on: every route first checks the module.automation
// flag in the demo flag store (403 FEATURE_LOCKED when off). Persistence is
// DB-backed (AutomationRule / AutomationRunLog tables via automationStore),
// labelled in meta.
// RBAC (pending catalogue addition, see src/automation/guard.ts):
// automation.view for reads, automation.manage for writes.

export async function GET() {
  const guard = await requireFeatureAdmin("module.automation", "automation.view");
  if (!guard.ok) return NextResponse.json(featureGuardError(guard), { status: guard.status });
  return NextResponse.json({
    data: {
      flags: demoFeatureFlags.list(),
      rules: await automationStore.listRules(),
    },
    meta: { persistence: "database", execution: "automation-run-worker" },
  });
}

export async function POST(req: Request) {
  const guard = await requireFeatureAdmin("module.automation", "automation.manage");
  if (!guard.ok) return NextResponse.json(featureGuardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = createRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid rule.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const now = new Date().toISOString();
  const rule: AutomationRule = {
    id: `rule_${Date.now()}`,
    ...parsed.data,
    description: parsed.data.description,
    createdBy: guard.userId,
    createdAt: now,
    updatedAt: now,
  };
  await automationStore.createRule(rule);
  return NextResponse.json(
    { data: { rule }, meta: { persistence: "database" } },
    { status: 201 },
  );
}
