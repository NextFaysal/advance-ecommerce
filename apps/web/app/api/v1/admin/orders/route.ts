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
 * Bulk POST registers a real job in src/jobs/bulk-actions.ts and triggers
 * its in-process processor (BullMQ is not installed yet — processBulkJob is
 * the exact function the future worker will run). It returns 202 with the
 * jobId; per-order results land on GET /api/v1/admin/jobs/{id}. Courier
 * booking inside a job is SANDBOX-only and print is payload-only — the job
 * results say so per order, nothing is faked.
 */
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken, type SessionUser } from "@/lib/auth";
import { phoneForViewer, requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import {
  createOrderRecord,
  findOrderByIdempotencyKey,
  getVariantSnapshots,
  listOrders,
  listOrdersByPhone,
  orderRowToEnriched,
} from "@/orders/repository";
import type { Order } from "@/orders/types";
import { enqueueBulkJob, processBulkJob } from "@/jobs/bulk-actions";
import { manualOrderSchema } from "@/orders/manual-order";
import { normalizeBdPhone } from "@/checkout/validation";
import { computePricing } from "@/checkout/pricing";
import { assembleFraudInput, fraudEnforcement } from "@/checkout/order-enrichment";
import { scoreFraud } from "@/fraud/scoring";
import { publishOrderCreated } from "@/orders/event-bus";

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
  const { rows, total } = await listOrders({
    status: q.status,
    paymentStatus: q.paymentStatus,
    paymentMethod: q.paymentMethod,
    courier: q.courier,
    search: q.search,
    page: q.page,
    pageSize: q.pageSize,
  });
  const pageRows = rows.map((o) => publicOrder(o, auth.session.user.permissions));
  return NextResponse.json({
    data: pageRows,
    meta: { total, page: q.page, pageSize: q.pageSize, db: "PRISMA", source: "DATABASE" },
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

/* ------------------------------------------------------------------ */
/* Manual order create (staff-entered phone / call-centre orders)      */
/* ------------------------------------------------------------------ */

// The manual-order form schema (src/orders/manual-order) + an optional
// client idempotency key (UUID). The admin orders page generates one
// key per form attempt and reuses it across retries, so a double
// submit replays instead of duplicating; without a key the server
// mints one (the UNIQUE Order.idempotencyKey column is the backstop,
// exactly as in the public create path).
const manualCreateSchema = manualOrderSchema.extend({
  idempotencyKey: z.string().uuid().optional(),
});

/**
 * Creates a manual order through the SAME path as public checkout:
 * variant snapshots from the DB (existence + stock), the computePricing
 * pipeline, the real scoreFraud() with identical enforcement
 * (block -> 422 FRAUD_BLOCKED), and createOrderRecord's one-transaction
 * persist (customer upsert by phone, history, UNPAID Payment row).
 *
 * Deliberate differences from public checkout, all surfaced in meta:
 * - Item prices are STAFF-ENTERED (manualOrderSchema contract: phone
 *   orders may carry a negotiated price). Product name + SKU still
 *   come from the DB snapshot, never from the client, and any price
 *   that differs from the catalog price is recorded on the order note.
 * - No coupon and no shipping method exist on the manual form, so
 *   discount and shipping are 0 — the total is the items subtotal.
 * - The order is stored with source "manual" (Order.source) instead of
 *   the public path's "website".
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
  const input = parsed.data;
  // manualOrderSchema validated the pattern; normalize to the stored
  // +8801XXXXXXXXX form exactly like the checkout schema transform.
  const phone = normalizeBdPhone(input.phone);
  if (!phone) {
    return err("VALIDATION_ERROR", "Manual order input invalid.", 400, ["phone: invalid BD phone"]);
  }
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  const permissions = session.user.permissions;

  // Idempotency first: a replay returns the stored order, never a copy.
  const existingRow = await findOrderByIdempotencyKey(idempotencyKey);
  if (existingRow) {
    return NextResponse.json(
      {
        data: { order: publicOrder(orderRowToEnriched(existingRow), permissions) },
        meta: { idempotentReplay: true, db: "PRISMA", source: "DATABASE", createdVia: "admin-manual" },
      },
      { status: 200 },
    );
  }

  // DB snapshots: existence, stock, product name + SKU. Only the unit
  // price is staff-entered (see header note).
  const snapshots = await getVariantSnapshots(input.items.map((i) => i.variantId));
  const items: Order["items"] = [];
  const priceOverrides: string[] = [];
  let subtotalPoisha = 0;
  for (const item of input.items) {
    const server = snapshots.get(item.variantId);
    if (!server) {
      return err("VARIANT_NOT_FOUND", `Variant not found: ${item.variantId}`, 400);
    }
    if (server.stock < item.quantity) {
      return err("INSUFFICIENT_STOCK", `Insufficient stock for ${server.sku}.`, 400, {
        variantId: item.variantId,
        sku: server.sku,
        availableStock: server.stock,
        requested: item.quantity,
      });
    }
    items.push({
      variantId: server.variantId,
      productName: server.productName,
      sku: server.sku,
      unitPricePoisha: item.unitPricePoisha,
      quantity: item.quantity,
    });
    subtotalPoisha += item.unitPricePoisha * item.quantity;
    if (item.unitPricePoisha !== server.unitPricePoisha) {
      priceOverrides.push(
        `${server.sku}: কর্মীর দাম ${item.unitPricePoisha} পয়সা (ক্যাটালগ ${server.unitPricePoisha} পয়সা)`,
      );
    }
  }

  const priorOrders = await listOrdersByPhone(phone);
  const pricing = computePricing({
    itemsSubtotalPoisha: subtotalPoisha,
    couponDiscountPoisha: 0,
    shippingPoisha: 0,
    codFeePoisha: 0,
    taxBps: 0,
  });

  // Same fraud scoring + enforcement as public checkout. Signal details
  // never leave the server; staff see them in the admin fraud UI.
  const now = new Date().toISOString();
  const assessment = scoreFraud(
    await assembleFraudInput({
      phone,
      address: input.address,
      paymentMethod: input.paymentMethod,
      totalPoisha: pricing.grandTotalPoisha,
      itemKeys: items.map((i) => i.variantId),
      priorOrders,
      now,
    }),
  );
  const enforcement = fraudEnforcement(assessment);
  if (enforcement.blocked) {
    return err(
      "FRAUD_BLOCKED",
      "দুঃখিত, এই অর্ডারটি গ্রহণ করা যাচ্ছে না। সহায়তার জন্য আমাদের সাথে যোগাযোগ করুন। / Sorry, this order cannot be accepted. Please contact support for help.",
      422,
    );
  }

  // Staff note + price-override record share the order's note row, so
  // the negotiated pricing is visible in the order history.
  const noteParts = [
    input.note?.trim() ? input.note.trim() : null,
    priceOverrides.length > 0
      ? `ম্যানুয়াল অর্ডার — কর্মীর নির্ধারিত দাম: ${priceOverrides.join("; ")}`
      : null,
  ].filter((p): p is string => p !== null);

  const created = await createOrderRecord({
    idempotencyKey,
    customerName: input.customerName,
    customerPhone: phone,
    address: input.address,
    items,
    pricing: {
      subtotalPoisha: pricing.subtotalPoisha,
      discountPoisha: pricing.couponDiscountPoisha,
      shippingPoisha: pricing.shippingPoisha,
      codFeePoisha: pricing.codFeePoisha,
      taxPoisha: pricing.taxPoisha,
      totalPoisha: pricing.grandTotalPoisha,
    },
    paymentMethod: input.paymentMethod,
    riskScore: assessment.score,
    appliedCoupon: null,
    note: noteParts.length > 0 ? noteParts.join("\n") : undefined,
    source: "manual",
  });
  if (created.replayed) {
    const row = await findOrderByIdempotencyKey(idempotencyKey);
    if (row) {
      return NextResponse.json(
        {
          data: { order: publicOrder(orderRowToEnriched(row), permissions) },
          meta: { idempotentReplay: true, db: "PRISMA", source: "DATABASE", createdVia: "admin-manual" },
        },
        { status: 200 },
      );
    }
    return err("IDEMPOTENCY_CONFLICT", "This manual order was already processed.", 409);
  }

  // Reload the stored row so the response is exactly what persisted
  // (and publish order.created from that same stored truth).
  const storedRow = await findOrderByIdempotencyKey(idempotencyKey);
  const stored = storedRow ? orderRowToEnriched(storedRow) : null;
  if (stored) publishOrderCreated(stored);
  await writeAudit({
    actorId: session.user.id,
    action: "orders.create",
    entityType: "Order",
    entityId: created.orderId,
    afterJson: {
      orderNo: created.orderNo,
      source: "manual",
      totalPoisha: pricing.grandTotalPoisha,
      paymentMethod: input.paymentMethod,
      itemCount: items.length,
      riskScore: assessment.score,
    },
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  return NextResponse.json(
    {
      data: { order: stored ? publicOrder(stored, permissions) : null },
      meta: {
        db: "PRISMA",
        source: "DATABASE",
        createdVia: "admin-manual",
        fraudScored: true,
        advanceRequired: enforcement.advanceRequired,
        note: "Manual order persisted via the shared create path. Item prices are staff-entered (DB snapshot for name/SKU/stock); no coupon and no shipping charge on manual create — total is the items subtotal.",
      },
    },
    { status: 201 },
  );
}
