/**
 * Admin orders API — /api/v1/admin/orders
 * GET: list/filter, POST: bulk action job (Agent 63 pipeline).
 *
 * Auth: admin_session httpOnly cookie -> validateSessionToken (src/lib/auth).
 * RBAC: GET requires orders.view, bulk POST requires orders.update_status.
 * Audit: bulk actions are audited (writeAudit, best-effort, never blocks).
 * Format: { data, meta } / { error: { code, message, details } }.
 * Phone in list output is masked by default (phoneForViewer) — full phone
 * only for a viewer with customers.view_full_phone.
 *
 * TEMPORARY MOCK: list reads src/orders/mock.ts. Replace with a Prisma Order
 * query (filters + pagination in SQL) once Agent 6 merges the schema and
 * Prisma generate succeeds. Filters/pagination below mirror that query.
 * Bulk POST registers a real job in src/jobs/bulk-actions.ts and triggers
 * its in-process processor (BullMQ is not installed yet — processBulkJob is
 * the exact function the future worker will run). It returns 202 with the
 * jobId; per-order results land on GET /api/v1/admin/jobs/{id}. Courier
 * booking inside a job is SANDBOX-only and print is payload-only — the job
 * results say so per order, nothing is faked.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { phoneForViewer, requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { MOCK_ORDERS } from "@/orders/mock";
import type { Order } from "@/orders/types";
import { enqueueBulkJob, processBulkJob } from "@/jobs/bulk-actions";

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

const listQuerySchema = z.object({
  status: z.string().optional(),
  paymentStatus: z.string().optional(),
  paymentMethod: z.string().optional(),
  courier: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
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
  let rows = [...MOCK_ORDERS];
  if (q.status) rows = rows.filter((o) => o.status === q.status);
  if (q.paymentStatus) rows = rows.filter((o) => o.paymentStatus === q.paymentStatus);
  if (q.paymentMethod) rows = rows.filter((o) => o.paymentMethod === q.paymentMethod);
  if (q.courier) rows = rows.filter((o) => (o.courier ?? "") === q.courier);
  if (q.search) {
    const needle = q.search.toLowerCase();
    rows = rows.filter(
      (o) =>
        o.orderNo.toLowerCase().includes(needle) ||
        o.customerName.toLowerCase().includes(needle) ||
        o.customerPhone.includes(q.search as string) ||
        (o.trackingId ?? "").toLowerCase().includes(needle),
    );
  }
  const total = rows.length;
  const start = (q.page - 1) * q.pageSize;
  const pageRows = rows.slice(start, start + q.pageSize).map((o) => publicOrder(o, auth.session.user.permissions));
  return NextResponse.json({
    data: pageRows,
    meta: { total, page: q.page, pageSize: q.pageSize, db: "NOT_WIRED", source: "TEMPORARY_MOCK" },
  });
}

const bulkSchema = z
  .object({
    action: z.enum(["confirm", "print_label", "book_courier", "update_status", "tag"]),
    orderIds: z.array(z.string().min(1)).min(1).max(200),
    tag: z.string().min(1).optional(),
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
  const auth = await requireAdmin("orders.update_status");
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => null);
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
        processor: "in-process-demo",
        queue: job.queue,
        idempotentReplay: !created,
        note: created
          ? "Bulk job registered and processing in-process (demo processor — the BullMQ worker will run the same processBulkJob later). Poll GET /api/v1/admin/jobs/<jobId> for per-order results. Courier bookings are SANDBOX-only; print produces a payload only."
          : "Idempotency key already used — returning the existing job; nothing was re-processed.",
      },
    },
    { status: 202 },
  );
  if (created) {
    // Trigger processing off the request path. Under BullMQ this enqueue
    // becomes a queue add and the worker calls processBulkJob(job.id).
    queueMicrotask(() => {
      void processBulkJob(job.id).catch(() => undefined);
    });
  }
  return response;
}
