import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import {
  CALL_SCRIPT_SOURCES,
  listEffectiveScripts,
  saveScript,
  scriptSaveInputSchema,
  type CallScriptSource,
} from "@/callcenter/scripts-store";
import { writeAudit } from "@/lib/audit";
import { z } from "zod";

// Call-center scripts — C3. Per-source scripts live as versioned JSON
// docs in the Setting store (src/callcenter/scripts-store.ts), the CMS
// site-content pattern. GET lists every source with its EFFECTIVE
// script (saved doc or the built-in v1, flagged isDefault). PUT saves
// one source and bumps its version. RBAC mirrors the sibling
// call-center routes: orders.view (read) / orders.update_status
// (write); the save is audit-logged. Flag: module.call_center.
function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "Call center module is locked for this install (module.call_center is OFF)." } },
    { status: 403 },
  );
}

function dbNotReady() {
  return NextResponse.json(
    { error: { code: "DB_NOT_READY", message: "Call-center database is not available." } },
    { status: 503 },
  );
}

export async function GET() {
  const guard = await requireAdmin("orders.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  await ensureDbFeatureFlags();
  if (!isCallCenterEnabled(demoCallCenterFlags)) return locked();
  try {
    const scripts = await listEffectiveScripts();
    return NextResponse.json({
      data: { scripts },
      meta: { persistence: "database", module: "module.call_center" },
    });
  } catch {
    return dbNotReady();
  }
}

const putBodySchema = z.object({
  source: z.enum(["PENDING_ORDER", "FAILED_DELIVERY", "ABANDONED_CHECKOUT", "MANUAL", "DEFAULT"]),
  steps: scriptSaveInputSchema.shape.steps,
});

export async function PUT(req: Request) {
  const guard = await requireAdmin("orders.update_status");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  await ensureDbFeatureFlags();
  if (!isCallCenterEnabled(demoCallCenterFlags)) return locked();
  const parsed = putBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "source + valid steps required.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const source = parsed.data.source as CallScriptSource;
  if (!(CALL_SCRIPT_SOURCES as readonly string[]).includes(source)) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: `Unknown script source: ${source}` } },
      { status: 400 },
    );
  }
  try {
    const saved = await saveScript(source, parsed.data.steps, guard.userId);
    // Audit the save (best-effort: the save already persisted; an audit
    // failure must not turn a successful save into a 500).
    try {
      await writeAudit({
        actorId: guard.userId,
        action: "call_center.script_update",
        entityType: "CallCenterScript",
        entityId: source,
        afterJson: { version: saved.version, versionLabel: saved.versionLabel, stepCount: saved.steps.length },
      });
    } catch {
      /* audit is best-effort here */
    }
    return NextResponse.json({
      data: { script: saved },
      meta: { persistence: "database", module: "module.call_center" },
    });
  } catch {
    return dbNotReady();
  }
}
