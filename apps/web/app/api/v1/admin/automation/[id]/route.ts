import { NextResponse } from "next/server";
import { featureGuardError, requireFeatureAdmin } from "@/automation/guard";
import { demoAutomationStore } from "@/automation/store";
import { updateRuleSchema, type AutomationRule } from "@/automation/types";

// One automation rule — Agent 13. PATCH covers partial updates AND the
// enable/disable toggle (enabled is part of updateRuleSchema). A disabled
// rule stays stored; the engine evaluates it as not_matched (see engine.ts).

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireFeatureAdmin("module.automation", "automation.view");
  if (!guard.ok) return NextResponse.json(featureGuardError(guard), { status: guard.status });
  const rule = demoAutomationStore.getRule(params.id);
  if (!rule) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Rule not found." } }, { status: 404 });
  }
  return NextResponse.json({ data: { rule }, meta: { persistence: "in-memory-demo" } });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireFeatureAdmin("module.automation", "automation.manage");
  if (!guard.ok) return NextResponse.json(featureGuardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = updateRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid rule update.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const patch: Partial<AutomationRule> = { ...parsed.data, updatedAt: new Date().toISOString() };
  const updated = demoAutomationStore.updateRule(params.id, patch);
  if (!updated) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Rule not found." } }, { status: 404 });
  }
  return NextResponse.json({ data: { rule: updated }, meta: { persistence: "in-memory-demo" } });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireFeatureAdmin("module.automation", "automation.manage");
  if (!guard.ok) return NextResponse.json(featureGuardError(guard), { status: guard.status });
  const removed = demoAutomationStore.deleteRule(params.id);
  if (!removed) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Rule not found." } }, { status: 404 });
  }
  return NextResponse.json({ data: { deleted: true }, meta: { persistence: "in-memory-demo" } });
}
