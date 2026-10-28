/**
 * Admin order workflow stage — /api/v1/admin/orders/[id]/stage
 * (ADV-26 remainder, BUILD-LITE).
 *
 *   GET  -> picker data for the detail-page panel: the configured
 *           stages, the order's current stage view + canonical
 *           status, and the module flag state. Requires orders.view.
 *           NOT flag-gated (it reports moduleEnabled so the panel
 *           can hide itself honestly when the add-on is OFF).
 *   POST { stageId: string | null, reason? }
 *        -> set the order's stage, or clear it with stageId null.
 *           Requires orders.edit; audited (orders.workflow_stage.set)
 *           with before/after stage ids. FLAG-GATED: 403
 *           FEATURE_LOCKED while `module.workflow_stages` is OFF —
 *           assignment is inert then (the stages.ts contract).
 *
 * The stage is a LABEL anchored at the order's current canonical
 * status: a stage anchored elsewhere is 400 STAGE_ANCHOR_MISMATCH,
 * an undefined stage id is 400 STAGE_NOT_FOUND. `Order.status` is
 * never written here — canonical transitions keep going through
 * PATCH /api/v1/admin/orders/[id] (applyOrderTransition), whose
 * post-commit reconcile clears a stage whose anchor stops matching.
 */
import { cookies } from "next/headers";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { getOrderByIdOrNo } from "@/orders/repository";
import {
  WORKFLOW_STAGES_FLAG,
  getOrderWorkflowStageView,
  isWorkflowStagesEnabled,
  loadWorkflowStagesConfig,
  setOrderStage,
  stageIdFromTags,
} from "@/orders/stages";

export const dynamic = "force-dynamic";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

async function requireAdmin(permission: PermissionKey) {
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

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  await ensureDbFeatureFlags().catch(() => {});
  const auth = await requireAdmin("orders.view");
  if ("error" in auth) return auth.error;
  const order = await getOrderByIdOrNo(params.id);
  if (!order) return err("NOT_FOUND", "Order not found.", 404);
  const [{ config }, current] = await Promise.all([
    loadWorkflowStagesConfig(),
    getOrderWorkflowStageView(order.id),
  ]);
  return NextResponse.json({
    data: {
      flag: WORKFLOW_STAGES_FLAG,
      moduleEnabled: isWorkflowStagesEnabled(),
      orderStatus: order.status,
      // The raw tag truth rides along so the panel can show a stage
      // that is assigned but whose module is currently OFF (inert,
      // not lost) instead of pretending the order has none.
      assignedStageId: stageIdFromTags(order.tags),
      current,
      stages: config.stages,
    },
    meta: { db: "PRISMA", source: "DATABASE" },
  });
}

const postSchema = z.object({
  stageId: z.string().trim().min(1).max(40).nullable(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  await ensureDbFeatureFlags().catch(() => {});
  const auth = await requireAdmin("orders.edit");
  if ("error" in auth) return auth.error;
  if (!isWorkflowStagesEnabled()) {
    return err(
      "FEATURE_LOCKED",
      `Workflow stages module is locked for this install (${WORKFLOW_STAGES_FLAG} is OFF).`,
      403,
    );
  }
  const body = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return err(
      "VALIDATION_ERROR",
      "Workflow stage input invalid.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const order = await getOrderByIdOrNo(params.id);
  if (!order) return err("NOT_FOUND", "Order not found.", 404);

  const result = await setOrderStage(order.id, parsed.data.stageId);
  if (!result.ok) {
    if (result.code === "ORDER_NOT_FOUND") return err("NOT_FOUND", result.error, 404);
    return err(result.code, result.error, 400);
  }
  await writeAudit({
    actorId: auth.session.user.id,
    action: "orders.workflow_stage.set",
    entityType: "Order",
    entityId: order.id,
    beforeJson: { workflowStageId: result.before },
    afterJson: { workflowStageId: result.after },
    reason: parsed.data.reason,
  });
  const current = await getOrderWorkflowStageView(order.id);
  return NextResponse.json({
    data: { orderId: order.id, orderStatus: result.orderStatus, current },
    meta: { db: "PRISMA", source: "DATABASE" },
  });
}
