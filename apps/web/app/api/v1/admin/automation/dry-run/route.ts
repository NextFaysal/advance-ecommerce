import { NextResponse } from "next/server";
import { runRule } from "@/automation/engine";
import { featureGuardError, requireFeatureAdmin } from "@/automation/guard";
import { automationStore } from "@/automation/store";
import { dryRunSchema, type AutomationRule } from "@/automation/types";

// Automation dry-run — Agent 13. Evaluates a rule (stored by ruleId, or a
// full draft in the body) against a sample event WITHOUT applying anything:
// effects come back as descriptions with status "planned", and the run log
// is NOT persisted (meta.persisted = false). Safe to run against real order
// snapshots pasted from the order workspace.

export async function POST(req: Request) {
  const guard = await requireFeatureAdmin("module.automation", "automation.view");
  if (!guard.ok) return NextResponse.json(featureGuardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = dryRunSchema.safeParse(body);
  if (!parsed.success || (!parsed.data.ruleId && !parsed.data.rule)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Provide ruleId or a full rule draft, plus a sample event.",
          details: parsed.success ? [] : parsed.error.issues,
        },
      },
      { status: 400 },
    );
  }
  let rule: AutomationRule;
  if (parsed.data.ruleId) {
    const stored = await automationStore.getRule(parsed.data.ruleId);
    if (!stored) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Rule not found." } }, { status: 404 });
    }
    rule = stored;
  } else {
    const now = new Date().toISOString();
    const draft = parsed.data.rule as NonNullable<typeof parsed.data.rule>;
    rule = { id: "rule_draft", ...draft, description: draft.description, createdAt: now, updatedAt: now };
  }
  const log = runRule(rule, parsed.data.event, { dryRun: true, runId: `run_dry_${Date.now()}` });
  return NextResponse.json({
    data: { log },
    meta: { persisted: false, applied: false, persistence: "database" },
  });
}
