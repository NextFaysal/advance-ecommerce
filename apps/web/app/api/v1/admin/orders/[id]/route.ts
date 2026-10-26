/**
 * Admin order detail — /api/v1/admin/orders/[id]
 * GET: detail (masked phone by default). PATCH: status transition.
 *
 * PATCH rules (real, via src/orders/state-machine — the single
 * authority for transitions):
 * - requires orders.update_status
 * - invalid transitions are REJECTED (422), never coerced, and write
 *   nothing to the DB
 * - reason is REQUIRED for CANCELLED and REFUNDED (state-machine check)
 * - PENDING -> CONFIRMED is additionally gated (wave 21, doc 17 O3):
 *   an unsatisfied persisted advance returns 409 ADVANCE_NOT_PAID and
 *   an unverified OTP returns 409 OTP_NOT_VERIFIED; the advance block
 *   (never the OTP block) can be overridden with
 *   advanceOverride { reason } by a holder of orders.override_advance
 * - GET carries the advance read model as data.advance, and the
 *   order's gift-card coverage (from the GiftCardTransaction ledger,
 *   the PDF invoice's own helper) as data.giftCard, so the print
 *   centre can decompose the gift-card tender out of its residual
 *   line exactly like the PDF does; the order's rental view rides
 *   as data.rental (wave 56) and its print-on-demand view —
 *   parsed from the create-time order note — as data.pod, only
 *   when the order carries a custom print
 * - the transition is audited (writeAudit, best-effort)
 *
 * DB-BACKED: the order is loaded from and persisted to Prisma via
 * src/orders/repository. PATCH goes through applyOrderTransition():
 * state machine decides, then Order.status + OrderStatusHistory are
 * written in one transaction. meta.persisted = true is now truthful.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { phoneForViewer, requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { applyOrderTransition, getOrderByIdOrNo } from "@/orders/repository";
import { getOrderAdvanceView } from "@/orders/advance";
import { getOrderApprovalState } from "@/orders/approvals";
import { getOrderGiftCardCoverage, getOrderRentalView } from "@/pdf/invoice-data";
import { getOrderPodView } from "@/pod/customisation";
import { getEntityCustomFieldValues } from "@/extensibility/custom-fields-store";
import { getOrderWorkflowStageView } from "@/orders/stages";
import type { OrderStatus } from "@/orders/types";

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
    return { error: err("DB_NOT_READY", "Session check needs a working database (Prisma generate + DB connection).", 503) };
  }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("orders.view");
  if ("error" in auth) return auth.error;
  const order = await getOrderByIdOrNo(params.id);
  if (!order) return err("NOT_FOUND", "Order not found.", 404);
  const view = { ...order, customerPhone: phoneForViewer(order.customerPhone, auth.session.user.permissions) ?? "" };
  // Wave 21 (doc 17, O3): the advance read model (required / paid /
  // remaining / satisfied / OTP state / active link) rides on the
  // detail payload as `advance` — the detail page's panel renders it.
  const advance = await getOrderAdvanceView(params.id);
  // ADV-27: the approval state (pending discount approval + refund
  // approvals, from src/orders/approvals) rides as data.approval so
  // the workspace can show "অনুমোদনের অপেক্ষায়" instead of the block
  // being visible only as a failed confirm attempt.
  const approval = await getOrderApprovalState(order.id);
  // Gift-card coverage from the recorded ledger (REDEEM −
  // REFUND_RESTORE for this order; { netPoisha: 0, codeLast4: null }
  // when no card touched the order) — the same helper the PDF
  // invoice read model uses, so screen, print and PDF agree.
  const giftCard = await getOrderGiftCardCoverage(order.id);
  // ADV-23 rental (wave 56): the order's RentalBooking view (frozen
  // deposit + window + status; null for non-rental orders) rides as
  // data.rental — the detail page + print centre decompose the
  // deposit out of the money residual from it, the same helper the
  // PDF invoice read model uses, so all three surfaces agree.
  const rental = await getOrderRentalView(order.id);
  // ADV-23 vertical 5 (wave 56): the order's print-on-demand view
  // (frozen print text + colour + fee + printed attestation, parsed
  // from the create-time order note — this vertical has no table)
  // rides as data.pod, ONLY when the order carries a custom print
  // (the customFields additive precedent). The detail page shows
  // the print shop exactly what to print; the print centre
  // decomposes the fee out of its residual from it.
  const pod = await getOrderPodView(order.id);
  // ADV-26 (wave 53): merchant custom-field values ride along
  // additively — the key appears ONLY when this order has values.
  const customFields = await getEntityCustomFieldValues("order", order.id);
  // ADV-26 (BUILD-LITE): the order's workflow stage (merchant label
  // anchored at the canonical status — src/orders/stages.ts) rides
  // as data.workflowStage, ONLY when one is set and the add-on is ON
  // (the helper returns null in both other cases — same additive
  // discipline as pod/customFields). Order.status is untouched.
  const workflowStage = await getOrderWorkflowStageView(order.id);
  return NextResponse.json({
    data: { ...view, ...(advance ? { advance } : {}), approval, giftCard, rental, ...(pod ? { pod } : {}), ...(customFields ? { customFields } : {}), ...(workflowStage ? { workflowStage } : {}) },
    meta: { db: "PRISMA", source: "DATABASE" },
  });
}

const patchSchema = z.object({
  to: z.enum([
    "PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED",
    "FAILED", "RETURN_REQUESTED", "RETURNING", "RETURNED", "CANCELLED", "REFUNDED", "EXCHANGED",
  ]),
  reason: z.string().min(1).optional(),
  // Wave 21 (doc 17, O3): advance-gate override for a CONFIRMED move
  // whose advance is unpaid. Honoured only with the
  // orders.override_advance permission (checked in the repository
  // funnel against the session permissions passed below); the reason
  // is recorded on the order timeline + this route's audit entry.
  advanceOverride: z.object({ reason: z.string().min(1).max(500) }).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("orders.update_status");
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", "Status transition input invalid.", 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const result = await applyOrderTransition(
    params.id,
    parsed.data.to as OrderStatus,
    auth.session.user.id,
    parsed.data.reason,
    {
      advanceOverride: parsed.data.advanceOverride,
      actorPermissions: auth.session.user.permissions,
    },
  );
  if (result.kind === "not_found") return err("NOT_FOUND", "Order not found.", 404);
  if (result.kind === "blocked") {
    // Wave 21: the advance/OTP confirm gate — a 409 whose code names
    // the block (ADVANCE_NOT_PAID / OTP_NOT_VERIFIED), bilingual
    // message from the gate itself.
    return err(result.code, result.error, 409);
  }
  if (result.kind === "invalid") {
    return err("INVALID_TRANSITION", result.error, 422);
  }
  await writeAudit({
    actorId: auth.session.user.id,
    action: "orders.update_status",
    entityType: "Order",
    entityId: result.order.id,
    beforeJson: { status: result.from },
    afterJson: {
      status: parsed.data.to,
      // The override (when one was supplied + honoured) is part of
      // the audit record alongside the timeline note the funnel wrote.
      ...(parsed.data.advanceOverride
        ? { advanceOverride: { reason: parsed.data.advanceOverride.reason } }
        : {}),
    },
    reason: parsed.data.reason,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  return NextResponse.json({
    data: { ...result.order, customerPhone: phoneForViewer(result.order.customerPhone, auth.session.user.permissions) ?? "" },
    meta: { db: "PRISMA", persisted: true },
  });
}
