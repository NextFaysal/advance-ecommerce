/**
 * Admin orders API — /api/v1/admin/orders
 * GET: list/filter. POST dispatches on the body shape:
 *   - a body with an `action` field is a bulk action job (Agent 63
 *     pipeline), unchanged;
 *   - any other body is a MANUAL order create (staff-entered phone /
 *     call-centre order) through the same repository create path the
 *     public checkout uses.
 *
 * Auth: admin_session httpOnly cookie -> validateSessionToken (src/lib/auth).
 * RBAC: GET requires orders.view, bulk POST requires
 * orders.update_status, manual create requires orders.create.
 * Audit: bulk actions and manual creates are audited (writeAudit,
 * best-effort, never blocks).
 * Format: { data, meta } / { error: { code, message, details } }.
 * Phone in list output is masked by default (phoneForViewer) — full phone
 * only for a viewer with customers.view_full_phone.
 *
 * DB-BACKED: list reads real Order rows via src/orders/repository
 * (filters + pagination in SQL). The bulk POST below is unchanged.
 *
 * LIST V2 (doc 17 O6-2): the GET is true server pagination — `page`
 * (1-based), `pageSize` (default 25, max 100), `status`, `q` (alias
 * of `search`: orderNo / name / district / phone incl. suffix), and
 * `sort` (createdAt_desc default | createdAt_asc | totalPoisha_* |
 * status_*). meta carries `total` (FULL count with every filter,
 * status included) and `counts` (per-status totals over the set
 * filtered by everything EXCEPT status, so the filter chips stay
 * meaningful while one status is selected). Rows keep the exact
 * pre-v2 item shape; pre-v2 consumers (command palette etc.) that
 * pass ?search=&pageSize= and read data[] are unaffected.
 * Bulk POST registers a real job in src/jobs/bulk-actions.ts and triggers
 * its processing (ADV-10 dual trigger: a BullMQ dispatch for the worker
 * process plus the in-process trigger; processBulkJob's claim runs it
 * exactly once — processBulkJob is the exact function both paths run).
 * It returns 202 with the jobId; per-order results land on
 * GET /api/v1/admin/jobs/{id}. Courier
 * booking inside a job is SANDBOX-only and print is payload-only — the job
 * results say so per order, nothing is faked.
 */
import { cookies } from "next/headers";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken, type SessionUser } from "@/lib/auth";
import { phoneForViewer, requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { listOrders } from "@/orders/repository";
import { countOrdersByStatus } from "@/orders/list-v2";
import type { Order } from "@/orders/types";
import { enqueueBulkJob, triggerBulkJobProcessing } from "@/jobs/bulk-actions";
import { manualOrderSchema } from "@/orders/manual-order";
import { createManualOrder } from "@/orders/manual-create";
import { isWorkflowStagesEnabled, loadWorkflowStagesConfig } from "@/orders/stages";
import { restaurantSelectionSchema } from "@/restaurant/selection";
import { serviceBookingSelectionSchema } from "@/services/selection";
import { rentalSelectionSchema } from "@/rental/selection";
import { podSelectionSchema } from "@/pod/selection";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

type AdminSession = { user: SessionUser };

async function requireSession(): Promise<{ session: AdminSession } | { error: NextResponse }> {
  const token = cookies().get("admin_session")?.value;
  if (!token) return { error: err("UNAUTHENTICATED", "Admin login required.", 401) };
  try {
    const session = await validateSessionToken(token);
    if (!session) return { error: err("UNAUTHENTICATED", "Session expired or revoked.", 401) };
    return { session };
  } catch {
    return { error: err("DB_NOT_READY", "Session check needs a working database (Prisma generate + DB connection).", 503) };
  }
}

function checkPermission(session: AdminSession, permission: PermissionKey): NextResponse | null {
  try {
    requirePermission(session.user.permissions, permission);
    return null;
  } catch (e) {
    if (e instanceof RbacError) return err("FORBIDDEN", e.message, 403);
    return err("DB_NOT_READY", "Session check needs a working database (Prisma generate + DB connection).", 503);
  }
}

async function requireAdmin(permission: PermissionKey) {
  const s = await requireSession();
  if ("error" in s) return s;
  const denied = checkPermission(s.session, permission);
  if (denied) return { error: denied };
  return { session: s.session };
}

const listQuerySchema = z.object({
  status: z.string().optional(),
  // ADV-26 (BUILD-LITE): workflow-stage filter — a stage slug from
  // the orders.workflow_stages document; matches the `stage:<slug>`
  // order tag in SQL (src/orders/stages.ts).
  stage: z.string().optional(),
  paymentStatus: z.string().optional(),
  paymentMethod: z.string().optional(),
  courier: z.string().optional(),
  search: z.string().optional(),
  // List v2 (doc 17 O6-2): `q` is the v2 name for the same search;
  // when both are sent, q wins.
  q: z.string().optional(),
  sort: z
    .enum(["createdAt_desc", "createdAt_asc", "totalPoisha_desc", "totalPoisha_asc", "status_asc", "status_desc"])
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

function publicOrder(order: Order, permissions: readonly string[]): Order {
  return { ...order, customerPhone: phoneForViewer(order.customerPhone, permissions) ?? "" };
}

export async function GET(req: Request) {
  const auth = await requireAdmin("orders.view");
  if ("error" in auth) return auth.error;
  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return err("VALIDATION_ERROR", "List query invalid.", 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const q = parsed.data;
  const search = q.q ?? q.search;
  // Perf (2026-10-29 orders speed wave): the workflow-stages config
  // read joins the same parallel block instead of running as a
  // sequential round after it, and the rows use the slim list read
  // (ORDER_LIST_INCLUDE — newest-4 history + pickup-only notes; the
  // detail endpoint still serves the full relations).
  const [{ rows, total }, counts, workflowStages] = await Promise.all([
    listOrders(
      {
        status: q.status,
        paymentStatus: q.paymentStatus,
        paymentMethod: q.paymentMethod,
        courier: q.courier,
        search,
        stageId: q.stage,
        sort: q.sort,
        page: q.page,
        pageSize: q.pageSize,
      },
      { slim: true },
    ),
    // List v2: full-set status counts (SQL groupBy). They ignore the
    // status param on purpose — the chips must show what switching
    // status would yield under the CURRENT search/other filters.
    // meta.total above is the pager's number: status filter applied.
    // The stage filter is NOT one of the ignored ones: counts
    // describe the stage-filtered set, like search/payment do.
    countOrdersByStatus({
      paymentStatus: q.paymentStatus,
      paymentMethod: q.paymentMethod,
      courier: q.courier,
      search,
      stageId: q.stage,
    }),
    // ADV-26 (BUILD-LITE): when the workflow-stages add-on is ON, the
    // stage definitions ride in meta so the list page can resolve row
    // tags (`stage:<id>` — rows already carry tags) to chips and offer
    // the stage filter without a second request. Absent when OFF:
    // the layer is inert and the list renders exactly as before.
    isWorkflowStagesEnabled()
      ? loadWorkflowStagesConfig().then((c) => c.config.stages)
      : Promise.resolve(null),
  ]);
  const pageRows = rows.map((o) => publicOrder(o, auth.session.user.permissions));
  return NextResponse.json({
    data: pageRows,
    meta: {
      total,
      page: q.page,
      pageSize: q.pageSize,
      counts,
      ...(workflowStages ? { workflowStages } : {}),
      db: "PRISMA",
      source: "DATABASE",
    },
  });
}

const bulkSchema = z
  .object({
    action: z.enum(["confirm", "print_label", "book_courier", "update_status", "tag"]),
    orderIds: z.array(z.string().min(1)).min(1).max(200),
    tag: z.string().min(1).optional(),
    courier: z.string().min(1).optional(),
    // update_status only: target status + reason (reason is required by the
    // state machine itself for CANCELLED / REFUNDED).
    toStatus: z
      .enum([
        "PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED",
        "FAILED", "RETURN_REQUESTED", "RETURNING", "RETURNED", "CANCELLED", "REFUNDED", "EXCHANGED",
      ])
      .optional(),
    reason: z.string().min(1).optional(),
    // Optional client idempotency key (or send the Idempotency-Key header):
    // a replay returns the EXISTING job instead of processing twice.
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.action === "update_status" && !data.toStatus) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["toStatus"], message: "toStatus is required for update_status." });
    }
  });

export async function POST(req: Request) {
  await ensureDbFeatureFlags().catch(() => {});
  const s = await requireSession();
  if ("error" in s) return s.error;
  const body: unknown = await req.json().catch(() => null);
  // Dispatch on shape: bulk jobs always carry an `action`; a manual
  // create never does. Each branch enforces its own permission.
  const isBulk =
    typeof body === "object" && body !== null && "action" in (body as Record<string, unknown>);
  if (isBulk) {
    const denied = checkPermission(s.session, "orders.update_status");
    if (denied) return denied;
    return handleBulkAction(req, s.session, body);
  }
  const denied = checkPermission(s.session, "orders.create");
  if (denied) return denied;
  return handleManualCreate(req, s.session, body);
}

async function handleBulkAction(req: Request, session: AdminSession, body: unknown) {
  const auth = { session };
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", "Bulk action input invalid.", 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const idempotencyKey = req.headers.get("idempotency-key") ?? parsed.data.idempotencyKey ?? null;
  const { job, created } = enqueueBulkJob({
    action: parsed.data.action,
    orderIds: parsed.data.orderIds,
    requestedBy: auth.session.user.id,
    idempotencyKey,
    toStatus: parsed.data.toStatus,
    reason: parsed.data.reason,
    tag: parsed.data.tag,
    courier: parsed.data.courier,
  });
  await writeAudit({
    actorId: auth.session.user.id,
    action: "orders.bulk",
    entityType: "Order",
    entityId: null,
    afterJson: { jobId: job.id, action: job.action, orderCount: job.orderIds.length, idempotentReplay: !created },
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  const response = NextResponse.json(
    {
      data: { jobId: job.id, action: job.action, orderIds: job.orderIds, status: job.status },
      meta: {
        stub: false,
        processor: job.processor,
        queue: job.queue,
        idempotentReplay: !created,
        note: created
          ? "Bulk job registered (Redis-backed registry) and processing triggered — in-process now, and also dispatched to the bulk-actions BullMQ queue for the worker; exactly one of them executes it (claim). Poll GET /api/v1/admin/jobs/<jobId> for per-order results. Courier bookings are SANDBOX-only; print produces a payload only."
          : "Idempotency key already used — returning the existing job; nothing was re-processed.",
      },
    },
    { status: 202 },
  );
  if (created) {
    // Trigger processing off the request path (ADV-10 dual trigger:
    // BullMQ dispatch + in-process microtask; the claim inside
    // processBulkJob runs the job exactly once across both).
    triggerBulkJobProcessing(job.id);
  }
  return response;
}

/* ------------------------------------------------------------------ */
/* Manual order create (staff-entered phone / call-centre orders)      */
/* ------------------------------------------------------------------ */

// The manual-order form schema (src/orders/manual-order) + an optional
// client idempotency key (UUID). The admin orders page generates one
// key per form attempt and reuses it across retries, so a double
// submit replays instead of duplicating; without a key the server
// mints one (the UNIQUE Order.idempotencyKey column is the backstop,
// exactly as in the public create path). resellerCode (wave 6) lets
// staff attribute a phone order to a reseller by their ?ref= code; it
// resolves exactly like public checkout (ACTIVE resellers only) and an
// unknown/ineligible code never fails the create.
const manualCreateSchema = manualOrderSchema.extend({
  idempotencyKey: z.string().uuid().optional(),
  resellerCode: z.string().max(32).optional(),
  // ADV-23 (wave 56): the restaurant selection must be declared here
  // too — this route safeParses the body and passes parsed.data to
  // createManualOrder, and zod strips undeclared keys, so without
  // this line a staff-submitted selection would never reach the
  // service's restaurant gate.
  restaurant: restaurantSelectionSchema.optional(),
  // ADV-23 vertical 2 (wave 56): same forwarding for the service
  // booking selection — without this line a staff-submitted booking
  // would be stripped here and never reach the services gate in
  // createManualOrder.
  booking: serviceBookingSelectionSchema.optional(),
  // ADV-23 vertical 3 (wave 56): same forwarding for the rental
  // selection — without this line a staff-submitted rental would
  // be stripped here and never reach the rental gate in
  // createManualOrder.
  rental: rentalSelectionSchema.optional(),
  // ADV-23 vertical 5 (wave 56): same forwarding for the
  // print-on-demand customisation — without this line a
  // staff-submitted print text would be stripped here and never
  // reach the POD gate in createManualOrder.
  pod: podSelectionSchema.optional(),
  // Wave 21 (doc 17 batch O3): a staff-set advance requirement for
  // this order (poisha). Validated against the computed grand total
  // in the service (0..total); the persisted requirement is the MAX
  // of this, the fraud band, and a prepaid method's full total —
  // same engine as public checkout (src/orders/advance).
  advanceRequiredPoisha: z.number().int().min(0).optional(),
});

/**
 * Manual create DELEGATES to the shared service
 * (src/orders/manual-create.ts, extracted in doc 17 batch O4) — this
 * handler keeps only authentication, input validation, and the
 * mapping onto this endpoint's historical response shape. The
 * pipeline itself (DB snapshots, staff-entered prices recorded on the
 * note, shipping engine + staff override, shared coupon evaluation,
 * fraud scoring, wave-21 advance engine, reseller attribution,
 * createOrderRecord's one-transaction persist with source "manual")
 * lives in the service so the inbox conversion and the CSV import
 * create orders through the exact same path.
 */
async function handleManualCreate(req: Request, session: AdminSession, body: unknown) {
  const parsed = manualCreateSchema.safeParse(body);
  if (!parsed.success) {
    return err(
      "VALIDATION_ERROR",
      "Manual order input invalid.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const result = await createManualOrder(parsed.data, {
    id: session.user.id,
    permissions: session.user.permissions,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  if (!result.ok) {
    return err(result.code, result.message, result.httpStatus, result.details);
  }
  const permissions = session.user.permissions;
  if (result.replayed) {
    return NextResponse.json(
      {
        data: { order: result.order ? publicOrder(result.order, permissions) : null },
        meta: { idempotentReplay: true, db: "PRISMA", source: "DATABASE", createdVia: "admin-manual" },
      },
      { status: 200 },
    );
  }
  return NextResponse.json(
    {
      data: { order: result.order ? publicOrder(result.order, permissions) : null },
      meta: {
        db: "PRISMA",
        source: "DATABASE",
        createdVia: "admin-manual",
        fraudScored: true,
        resellerAttributed: result.resellerAttributed,
        advanceRequired: result.advance !== null,
        // Wave 21: the persisted advance block (same shape as public
        // checkout): amount, winning-rule label, one-time link.
        ...(result.advance
          ? {
              advance: {
                requiredPoisha: result.advance.requiredPoisha,
                reason: result.advance.reason,
                ...(result.advance.linkUrl
                  ? { linkUrl: result.advance.linkUrl, linkToken: result.advance.linkToken }
                  : {}),
              },
            }
          : {}),
        pricing: result.pricing,
        shippingMethod: result.shippingMethod,
        shippingDefaulted: result.shippingDefaulted,
        couponApplied: result.coupon?.applied ?? false,
        couponStatus: result.coupon?.status,
        couponCode: result.coupon?.code ?? null,
        couponReasonBn: result.coupon?.reasonBn ?? null,
        couponReasonEn: result.coupon?.reasonEn ?? null,
        note: "Manual order persisted via the shared create path. Item prices are staff-entered (DB snapshot for name/SKU/stock); shipping is the public-checkout rate for the method (or the staff override), and a coupon code is evaluated by the same evaluator as public checkout.",
      },
    },
    { status: 201 },
  );
}
