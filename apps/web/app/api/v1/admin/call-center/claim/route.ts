import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { toQueueItemView } from "@/callcenter/queue";
import { getEffectiveScript } from "@/callcenter/scripts-store";
import { claimNextTaskDb, claimTaskDb, type DbCallTask } from "@/callcenter/store";
import { CONFIRMATION_SCRIPT } from "@/callcenter/types";
import { writeAudit } from "@/lib/audit";

// Claim a call task — Agent 58 (G3 assignment enforcement).
// POST with no body (or no taskId) claims the highest-priority UNASSIGNED
// task for the SESSION user (claim-next). POST { taskId } claims that
// specific task. Claiming is the required first step before an outcome can
// be recorded (see outcome route: unassigned -> 409 TASK_UNASSIGNED).
// A task assigned to another agent can never be claimed (403
// TASK_ASSIGNED_TO_OTHER) — supervisors use the outcome override instead.
// Persistence: Prisma DB via src/callcenter/store.ts; the claim persists
// with a conditional update so two agents cannot claim the same task.
function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "Call center module is locked for this install (module.call_center is OFF)." } },
    { status: 403 },
  );
}

function view(task: DbCallTask, canViewFullPhone: boolean) {
  return toQueueItemView(task, canViewFullPhone && task.phoneResolved === true);
}

/**
 * R2.1 (plan doc 15): the EFFECTIVE script for the claimed task's
 * source — the admin-saved Setting doc via scripts-store when one
 * exists (its version, e.g. "v2"), else the built-in CONFIRMATION_SCRIPT
 * as "v1". Attached to the claim response as `task.script` so the
 * workbench renders the configured steps and stamps THIS version on
 * the outcome (before R2.1 it always rendered + stamped the built-in,
 * so C3 script edits had no effect on agents). scripts-store already
 * falls back to the built-in for missing/corrupt docs; a store read
 * FAILURE falls back the same way here — it must never fail the claim.
 */
async function scriptFor(task: DbCallTask) {
  try {
    const eff = await getEffectiveScript(task.source);
    return { version: eff.versionLabel, steps: eff.steps };
  } catch {
    return {
      version: "v1",
      steps: CONFIRMATION_SCRIPT.map((s) => ({
        key: s.key,
        promptBn: s.promptBn,
        promptEn: s.promptEn,
      })),
    };
  }
}

/**
 * Full-phone access audit (plan doc 15, R6.1 / C7 privacy hardening):
 * when a claim response reveals the FULL phone (phoneFull present in
 * the view), record WHO saw WHICH task's number WHEN in the real
 * AuditLog (readable on /admin/audit). The number itself — full or
 * masked — is NEVER written to the audit row; only the access event
 * (actor, task, source, channel). Masked-only views write nothing.
 * Best-effort: an audit failure must never fail the claim (mirrors
 * the scripts route's treatment of its audit write).
 */
async function auditPhoneView(
  taskView: ReturnType<typeof view>,
  actorId: string,
): Promise<void> {
  if (!taskView.phoneFull) return;
  try {
    await writeAudit({
      actorId,
      action: "call_center.phone_view",
      entityType: "CallTask",
      entityId: taskView.id,
      afterJson: { taskId: taskView.id, source: taskView.source, via: "claim" },
    });
  } catch {
    /* audit is best-effort here */
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin("orders.update_status");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  await ensureDbFeatureFlags();
  if (!isCallCenterEnabled(demoCallCenterFlags)) return locked();
  const canViewFullPhone = guard.permissions.includes("customers.view_full_phone");
  const body = (await req.json().catch(() => ({}))) as { taskId?: unknown };

  try {
    if (typeof body.taskId === "string") {
      const result = await claimTaskDb(body.taskId, guard.userId);
      if (!result.ok) {
        if (result.code === "NOT_FOUND") {
          return NextResponse.json({ error: { code: "NOT_FOUND", message: "Call task not found." } }, { status: 404 });
        }
        return NextResponse.json(
          { error: { code: result.code, message: result.error } },
          { status: result.code === "TASK_ASSIGNED_TO_OTHER" ? 403 : 409 },
        );
      }
      const taskView = view(result.task, canViewFullPhone);
      await auditPhoneView(taskView, guard.userId);
      const script = await scriptFor(result.task);
      return NextResponse.json({
        data: { task: { ...taskView, script }, alreadyMine: result.alreadyMine },
        meta: { persistence: "database" },
      });
    }

    const claimed = await claimNextTaskDb(guard.userId);
    const taskView = claimed ? view(claimed, canViewFullPhone) : null;
    if (taskView) await auditPhoneView(taskView, guard.userId);
    const script = claimed ? await scriptFor(claimed) : undefined;
    return NextResponse.json({
      data: { task: taskView ? { ...taskView, script } : null },
      meta: { persistence: "database" },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Call-center database is not available." } },
      { status: 503 },
    );
  }
}
