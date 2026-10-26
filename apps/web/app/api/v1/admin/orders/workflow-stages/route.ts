/**
 * Admin workflow-stages config API — /api/v1/admin/orders/workflow-stages
 * (ADV-26 remainder, BUILD-LITE — merchant order workflow stages).
 *
 *   GET -> the stored `orders.workflow_stages` document + its source
 *          ("saved" | "default") + the module flag state. Requires
 *          settings.view.
 *   PUT { stages, reason } -> whole-document replace. Requires
 *          settings.edit and a non-empty `reason`; validated by the
 *          stages zod schema (slug ids, unique, cap 20, anchor must
 *          be a canonical OrderStatus) and audited
 *          (orders.workflow_stages.update) with before/after docs.
 *
 * CONFIG-PREP PRECEDENT: these routes are NOT flag-gated — the
 * merchant defines stages while `module.workflow_stages` is OFF and
 * flips the flag when ready (the restaurant/services config-route
 * precedent). Assignment and display ARE flag-gated elsewhere.
 *
 * Storage is the Setting-document store in src/orders/stages.ts —
 * NOT the generic settings POST: setSetting() rejects keys outside
 * SETTING_DEFAULTS, the same reason restaurant.config has its own
 * route.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import {
  WORKFLOW_STAGES_DOC_KEY,
  WORKFLOW_STAGES_FLAG,
  isWorkflowStagesEnabled,
  loadWorkflowStagesConfig,
  saveWorkflowStagesConfig,
  workflowStagesPutBodySchema,
} from "@/orders/stages";

export const dynamic = "force-dynamic";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

async function requireAdmin(permission: "settings.view" | "settings.edit") {
  const token = cookies().get("admin_session")?.value;
  if (!token) return { error: err("UNAUTHENTICATED", "Admin login required.", 401) };
  try {
    const session = await validateSessionToken(token);
    if (!session) return { error: err("UNAUTHENTICATED", "Session expired or revoked.", 401) };
    requirePermission(session.user.permissions, permission);
    return { session };
  } catch (e) {
    if (e instanceof RbacError) return { error: err("FORBIDDEN", e.message, 403) };
    return { error: err("DB_NOT_READY", "Session check needs a working database.", 503) };
  }
}

export async function GET() {
  const auth = await requireAdmin("settings.view");
  if ("error" in auth) return auth.error;

  const loaded = await loadWorkflowStagesConfig();
  return NextResponse.json({
    data: {
      docKey: WORKFLOW_STAGES_DOC_KEY,
      flag: WORKFLOW_STAGES_FLAG,
      moduleEnabled: isWorkflowStagesEnabled(),
      config: loaded.config,
      source: loaded.source,
    },
    meta: { persistence: "setting-doc" },
  });
}

export async function PUT(req: Request) {
  const auth = await requireAdmin("settings.edit");
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const parsed = workflowStagesPutBodySchema.safeParse(body);
  if (!parsed.success) {
    return err(
      "VALIDATION_ERROR",
      "Workflow stages input invalid.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const { reason, ...config } = parsed.data;

  const before = await loadWorkflowStagesConfig();
  try {
    await saveWorkflowStagesConfig(config, auth.session.user.id);
  } catch {
    return err("DB_NOT_READY", "Workflow stages could not be saved (database error).", 503);
  }
  const after = await loadWorkflowStagesConfig();
  await writeAudit({
    actorId: auth.session.user.id,
    action: "orders.workflow_stages.update",
    entityType: "Setting",
    entityId: WORKFLOW_STAGES_DOC_KEY,
    beforeJson: before.config,
    afterJson: after.config,
    reason,
  });

  return NextResponse.json({
    data: {
      docKey: WORKFLOW_STAGES_DOC_KEY,
      config: after.config,
      source: after.source,
    },
    meta: { persistence: "setting-doc" },
  });
}
