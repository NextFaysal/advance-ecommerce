import { NextResponse } from "next/server";
import { processEvent } from "@/automation/engine";
import { featureGuardError, requireFeatureAdmin } from "@/automation/guard";
import { automationStore } from "@/automation/store";
import { automationEventSchema } from "@/automation/types";

// Automation runs — Agent 13; lifecycle wiring ADV-7.
// GET: run logs (newest last, optional ?ruleId= filter). Logs store the
// MASKED phone only.
// POST: manual event dispatch entry point. Evaluates every stored rule
// against the posted event, persists the run logs, and returns them.
// This route evaluates in-process — its logs carry the engine's effect
// descriptions. REAL lifecycle events (order.created, transitions,
// payment.succeeded, checkout.abandoned, stock.low) dispatch through
// src/automation/producers.ts onto the "automation-run" BullMQ queue;
// the worker evaluates them there and executes matched runs' send_sms /
// send_email effects for real, recording provider outcomes in the same
// run-log store (meta.execution names that worker path).

export async function GET(req: Request) {
  const guard = await requireFeatureAdmin("module.automation", "automation.view");
  if (!guard.ok) return NextResponse.json(featureGuardError(guard), { status: guard.status });
  const url = new URL(req.url);
  const ruleId = url.searchParams.get("ruleId") ?? undefined;
  return NextResponse.json({
    data: { runs: await automationStore.listRuns(ruleId) },
    meta: { persistence: "database", execution: "automation-run-worker" },
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
    meta: { persistence: "database", execution: "automation-run-worker" },
  });
}
