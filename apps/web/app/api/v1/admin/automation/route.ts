import { NextResponse } from "next/server";
import { demoFeatureFlags } from "@/automation/flags";
import { featureGuardError, requireFeatureAdmin } from "@/automation/guard";
import { demoAutomationStore } from "@/automation/store";
import { createRuleSchema, type AutomationRule } from "@/automation/types";

// Automation rules — Agent 13, Step 43 (A1).
// Module is a paid add-on: every route first checks the module.automation
// flag in the demo flag store (403 FEATURE_LOCKED when off). Persistence is
// the in-memory demo store, labelled in meta — a Prisma-backed store must
// implement the same AutomationStore interface.
// RBAC (pending catalogue addition, see src/automation/guard.ts):
// automation.view for reads, automation.manage for writes.

export async function GET() {
  const guard = await requireFeatureAdmin("module.automation", "automation.view");
  if (!guard.ok) return NextResponse.json(featureGuardError(guard), { status: guard.status });
  return NextResponse.json({
    data: {
      flags: demoFeatureFlags.list(),
      rules: demoAutomationStore.listRules(),
    },
    meta: { persistence: "in-memory-demo", execution: "bullmq-pending" },
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
  demoAutomationStore.createRule(rule);
  return NextResponse.json(
    { data: { rule }, meta: { persistence: "in-memory-demo" } },
    { status: 201 },
  );
}
