import { NextResponse } from "next/server";
import { processEvent } from "@/automation/engine";
import { featureGuardError, requireFeatureAdmin } from "@/automation/guard";
import { automationStore } from "@/automation/store";
import { automationEventSchema } from "@/automation/types";

// Automation runs — Agent 13.
// GET: run logs (newest last, optional ?ruleId= filter). Logs store the
// MASKED phone only.
// POST: event dispatch entry point. Evaluates every stored rule against
// the event, persists the run logs, and returns them. Effects in the logs
// are descriptions only — executing them (order writes, courier booking,
// SMS/email sends) is the BullMQ "automation-run" worker's job and is NOT
// wired yet (meta.execution says so).

export async function GET(req: Request) {
  const guard = await requireFeatureAdmin("module.automation", "automation.view");
  if (!guard.ok) return NextResponse.json(featureGuardError(guard), { status: guard.status });
  const url = new URL(req.url);
  const ruleId = url.searchParams.get("ruleId") ?? undefined;
  return NextResponse.json({
    data: { runs: await automationStore.listRuns(ruleId) },
    meta: { persistence: "database", execution: "bullmq-pending" },
  });
}

export async function POST(req: Request) {
  const guard = await requireFeatureAdmin("module.automation", "automation.manage");
  if (!guard.ok) return NextResponse.json(featureGuardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = automationEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid event.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const stamp = Date.now();
  const logs = processEvent(await automationStore.listRules(), parsed.data, {
    dryRun: false,
    runIdFor: (rule, index) => `run_${stamp}_${index}_${rule.id}`,
  });
  for (const log of logs) await automationStore.appendRun(log);
  return NextResponse.json({
    data: { runs: logs },
    meta: { persistence: "database", execution: "bullmq-pending" },
  });
}
