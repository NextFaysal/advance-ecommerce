/**
 * Bulk order actions — job pipeline (Agent 63, Steps 17/22).
 *
 * Until now POST /api/v1/admin/orders (bulk) only validated + audited and
 * returned 202 QUEUED_FOR_BULK_JOB — nothing ever processed the job. This
 * module is the REAL processor: a typed job model, an in-process registry,
 * and `processBulkJob()`, an executor that runs the action per order
 * against the existing order store + state machine + print helpers +
 * SANDBOX courier adapter.
 *
 * BullMQ is not installed yet, so the admin route enqueues here and
 * triggers processing on a microtask in the SAME process. When BullMQ
 * lands, `processBulkJob` becomes the handler body for the bulk-actions
 * queue verbatim — the worker will load the job by id and call it exactly
 * the way the route and the tests do. Only the trigger changes.
 *
 * Honesty rules (no fake success anywhere):
 *  - confirm / update_status go through the order state machine. Invalid
 *    transitions are per-order failures carrying the state machine's own
 *    reason — never forced, never coerced.
 *  - confirm into CONFIRMED also honours the advance/OTP gate
 *    (wave 21, doc 17 O3, src/orders/advance.advanceConfirmBlock): a
 *    PENDING order whose advance is unpaid (or OTP unverified) fails
 *    per-order with ADVANCE_NOT_PAID / OTP_NOT_VERIFIED. The bulk
 *    pipeline has NO override channel (no per-order reason/permissions
 *    in the job model) — overrides happen on the single-order PATCH.
 *  - print_label builds the print PAYLOAD only (orders/print.ts). Nothing
 *    is sent to a printer; the result carries a payload ref saying so.
 *  - book_courier books through the SANDBOX courier adapter only. The
 *    tracking id is SBX-prefixed by the adapter and the result message
 *    says SANDBOX — no real courier is contacted.
 *  - Partial failure is a first-class outcome: a job with some failed
 *    orders ends COMPLETED_WITH_FAILURES, lists every failure, and never
 *    rolls back the orders that succeeded.
 *  - The job REGISTRY is still in-memory (a jobs table / BullMQ
 *    replaces it later), but ORDER persistence is now the real Prisma
 *    store by default (src/orders/repository): the default
 *    BulkOrderStore reads and writes DB Order rows, and transitions
 *    persisted through it carry their OrderStatusHistory rows. The
 *    demo store remains available for tests via demoBulkOrderStore.
 */
import { createHash, randomUUID } from "node:crypto";
import { DEFAULT_RETRY, type JobRetryPolicy } from "./queues";
import { findMockOrder, MOCK_ORDERS } from "../orders/mock";
import { getOrderByIdOrNo, saveOrder } from "../orders/repository";
import { advanceConfirmBlock } from "../orders/advance";
import { buildPrintData } from "../orders/print";
import { transitionOrder } from "../orders/state-machine";
import type { Order, OrderStatus } from "../orders/types";
import { maskPhone } from "../checkout/validation";
import type { CourierProvider } from "../integrations/courier";
import {
  createSandboxCourierProvider,
  type SandboxCourierProvider,
} from "../integrations/sandbox/courier-provider";

/**
 * The queue these jobs will ride once BullMQ is wired. It is not in
 * QUEUE_NAMES yet (src/jobs/queues.ts is owned by the jobs-contract
 * slice); when workers land, add `bulkActions: "bulk-actions"` there and
 * register `processBulkJob` as its handler. Retry follows DEFAULT_RETRY.
 */
export const BULK_ACTIONS_QUEUE_NAME = "bulk-actions" as const;

export type BulkActionName =
  | "confirm"
  | "print_label"
  | "book_courier"
  | "update_status"
  // "tag" predates this pipeline in the bulk route's validation schema;
  // it is kept so existing validated callers keep working, now as a
  // real per-order action instead of a stub.
  | "tag";

export type BulkJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "COMPLETED_WITH_FAILURES"
  | "FAILED";

export interface BulkOrderResult {
  orderId: string;
  ok: boolean;
  /** Machine code: INVALID_TRANSITION, ORDER_NOT_FOUND, SANDBOX_BOOKED, … */
  code?: string;
  message?: string;
  /** Id/ref only — print payload ref or sandbox shipment id. Never PII. */
  ref?: string;
  /** SBX-prefixed sandbox tracking id (book_courier only). */
  trackingId?: string;
}

export interface BulkJob {
  id: string;
  idempotencyKey: string | null;
  action: BulkActionName;
  orderIds: string[];
  /** Required for action "update_status" (validated at the route). */
  toStatus?: OrderStatus;
  /** Required by the state machine for CANCELLED / REFUNDED targets. */
  reason?: string;
  /** Required for action "tag". */
  tag?: string;
  requestedBy: string;
  status: BulkJobStatus;
  perOrderResults: BulkOrderResult[];
  queue: typeof BULK_ACTIONS_QUEUE_NAME;
  retryPolicy: JobRetryPolicy;
  /** How this job is being executed in this deployment — never "bullmq" until it is. */
  processor: "in-process-demo";
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Job-level failure (executor blew up), distinct from per-order failures. */
  lastError?: string;
}

export interface EnqueueBulkJobInput {
  action: BulkActionName;
  orderIds: string[];
  requestedBy: string;
  idempotencyKey?: string | null;
  toStatus?: OrderStatus;
  reason?: string;
  tag?: string;
}

/* ------------------------------------------------------------------ */
/* Order store seam — default is now the Prisma-backed store           */
/* (src/orders/repository). Tests can still inject demoBulkOrderStore  */
/* or their own implementation; find/save are async because the DB is. */
/* ------------------------------------------------------------------ */

export interface BulkOrderStore {
  /** Find by internal id or order number (same semantics as findMockOrder). */
  find(id: string): Promise<Order | undefined>;
  /** Persist a mutated order back into the store. */
  save(order: Order): Promise<void>;
}

export const demoBulkOrderStore: BulkOrderStore = {
  async find(id) {
    return findMockOrder(id);
  },
  async save(order) {
    const idx = MOCK_ORDERS.findIndex((o) => o.id === order.id);
    if (idx >= 0) MOCK_ORDERS[idx] = order;
    else MOCK_ORDERS.push(order);
  },
};

/** DB-backed default: reads/writes real Order rows via the repository.
 *  save() persists scalars + appended history + tag changes; the state
 *  machine remains the only place a status transition is decided. */
export const prismaBulkOrderStore: BulkOrderStore = {
  async find(id) {
    return (await getOrderByIdOrNo(id)) ?? undefined;
  },
  async save(order) {
    await saveOrder(order);
  },
};

export interface BulkProcessDeps {
  orders?: BulkOrderStore;
  /** Resolve a courier adapter by sandbox provider key (tests count calls). */
  courierProviderFor?: (name: SandboxCourierProvider) => CourierProvider;
  now?: () => Date;
}

/* ------------------------------------------------------------------ */
/* In-memory job registry (demo). BullMQ + a jobs table replace this;  */
/* the route and status endpoint only use the functions below.         */
/* ------------------------------------------------------------------ */

const jobsById = new Map<string, BulkJob>();
const jobIdByIdempotencyKey = new Map<string, string>();

function jobIdForIdempotencyKey(key: string): string {
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 24);
  return `bulk-${digest}`;
}

export function getBulkJob(id: string): BulkJob | undefined {
  return jobsById.get(id);
}

export function findBulkJobByIdempotencyKey(key: string): BulkJob | undefined {
  const id = jobIdByIdempotencyKey.get(key);
  return id ? jobsById.get(id) : undefined;
}

export function listBulkJobs(): BulkJob[] {
  return [...jobsById.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Test-only reset so smoke runs start from an empty registry. */
export function clearBulkJobRegistry(): void {
  jobsById.clear();
  jobIdByIdempotencyKey.clear();
}

/**
 * Register a job as QUEUED. If the idempotency key was already used, the
 * EXISTING job is returned with `created: false` and nothing is
 * re-registered or re-processed — the route turns that into the
 * idempotent-replay response.
 */
export function enqueueBulkJob(input: EnqueueBulkJobInput): { job: BulkJob; created: boolean } {
  const key = input.idempotencyKey?.trim() ? input.idempotencyKey.trim() : null;
  if (key) {
    const existing = findBulkJobByIdempotencyKey(key);
    if (existing) return { job: existing, created: false };
  }
  const job: BulkJob = {
    id: key ? jobIdForIdempotencyKey(key) : `bulk-${randomUUID()}`,
    idempotencyKey: key,
    action: input.action,
    orderIds: [...input.orderIds],
    toStatus: input.toStatus,
    reason: input.reason,
    tag: input.tag,
    requestedBy: input.requestedBy,
    status: "QUEUED",
    perOrderResults: [],
    queue: BULK_ACTIONS_QUEUE_NAME,
    retryPolicy: DEFAULT_RETRY,
    processor: "in-process-demo",
    createdAt: new Date().toISOString(),
  };
  jobsById.set(job.id, job);
  if (key) jobIdByIdempotencyKey.set(key, job.id);
  return { job, created: true };
}

/* ------------------------------------------------------------------ */
/* Per-order executors                                                 */
/* ------------------------------------------------------------------ */

const SANDBOX_PROVIDER_KEYS: readonly string[] = ["steadfast", "pathao", "redx"];

/** Order.courier carries a display name ("Steadfast"); adapters are keyed lowercase. */
function resolveSandboxProvider(courier: string | undefined): SandboxCourierProvider | null {
  if (!courier) return null;
  const key = courier.trim().toLowerCase();
  return SANDBOX_PROVIDER_KEYS.includes(key) ? (key as SandboxCourierProvider) : null;
}

const NOT_BOOKABLE_STATUSES: readonly OrderStatus[] = [
  "CANCELLED",
  "DELIVERED",
  "RETURNED",
  "REFUNDED",
  "EXCHANGED",
];

function fail(orderId: string, code: string, message: string): BulkOrderResult {
  return { orderId, ok: false, code, message };
}

async function runForOrder(
  job: BulkJob,
  orderId: string,
  deps: Required<BulkProcessDeps>,
): Promise<BulkOrderResult> {
  const order = await deps.orders.find(orderId);
  if (!order) return fail(orderId, "ORDER_NOT_FOUND", `Order ${orderId} not found.`);

  switch (job.action) {
    case "confirm":
    case "update_status": {
      const to: OrderStatus = job.action === "confirm" ? "CONFIRMED" : (job.toStatus as OrderStatus);
      if (job.action === "update_status" && !job.toStatus) {
        return fail(orderId, "TARGET_STATUS_REQUIRED", "update_status needs a target status (toStatus).");
      }
      // Advance/OTP confirm gate (wave 21, doc 17 O3): the bulk path
      // decides transitions itself (transitionOrder + saveOrder), so
      // it enforces the same gate applyOrderTransition enforces on
      // the single-order path. No override exists here by design.
      if (to === "CONFIRMED" && order.status === "PENDING") {
        const block = advanceConfirmBlock({
          advanceRequiredPoisha: order.advanceRequiredPoisha ?? 0,
          advanceSatisfiedAt: order.advanceSatisfiedAt ?? null,
          requiresOtp: order.requiresOtp ?? false,
          otpVerifiedAt: order.otpVerifiedAt ?? null,
        });
        if (block) return fail(orderId, block.code, block.message);
      }
      const result = transitionOrder(order, to, job.requestedBy, job.reason);
      if (!result.ok) return fail(orderId, "INVALID_TRANSITION", result.error);
      await deps.orders.save(result.order);
      return {
        orderId,
        ok: true,
        code: "TRANSITIONED",
        message: `${order.status} -> ${to} via the order state machine.`,
      };
    }

    case "print_label": {
      // Payload only — buildPrintData renders nothing and no printer is
      // contacted. The ref identifies the payload; claiming a physical
      // print here would be a fake success.
      const data = buildPrintData(order, "courier_label", "THERMAL_80", maskPhone(order.customerPhone));
      return {
        orderId,
        ok: true,
        code: "PRINT_PAYLOAD_READY",
        message: `Print payload generated for ${data.orderNo} (barcode ${data.barcodeValue}) — payload only, nothing was sent to a printer.`,
        ref: `print-payload:${order.id}:courier_label:THERMAL_80`,
      };
    }

    case "book_courier": {
      if (order.trackingId) {
        return {
          orderId,
          ok: true,
          code: "ALREADY_BOOKED",
          message: `Already booked — tracking ${order.trackingId}. Adapter not called again.`,
          trackingId: order.trackingId,
        };
      }
      if (NOT_BOOKABLE_STATUSES.includes(order.status)) {
        return fail(orderId, "ORDER_NOT_BOOKABLE", `Order in status ${order.status} cannot be booked with a courier.`);
      }
      const providerKey = resolveSandboxProvider(order.courier);
      if (!providerKey) {
        return fail(
          orderId,
          order.courier ? "COURIER_UNSUPPORTED" : "COURIER_NOT_CHOSEN",
          order.courier
            ? `Courier "${order.courier}" has no sandbox adapter (steadfast/pathao/redx only).`
            : "No courier chosen on this order — pick one before bulk booking.",
        );
      }
      const provider = deps.courierProviderFor(providerKey);
      const totalQuantity = order.items.reduce((sum, i) => sum + i.quantity, 0);
      try {
        const booked = await provider.createShipment({
          orderId: order.id,
          provider: provider.name,
          address: {
            recipientName: order.customerName,
            recipientPhone: order.customerPhone,
            division: order.address.division,
            district: order.address.district,
            upazila: order.address.upazila,
            union: order.address.union ?? null,
            addressLine: order.address.addressLine,
          },
          codAmountPoisha: order.paymentMethod === "cod" ? order.totalPoisha : 0,
          note: null,
          // Same conventions as the One-Click Flow panel (Agent 30).
          weightGrams: Math.max(100, totalQuantity * 500),
          itemCount: Math.max(1, totalQuantity),
          // Deterministic per job+order: reprocessing this job can never
          // double-book at the adapter (the sandbox store dedupes on it).
          idempotencyKey: `bulk-${job.id}-${order.id}`,
        });
        await deps.orders.save({ ...order, courier: providerKey, trackingId: booked.trackingId });
        return {
          orderId,
          ok: true,
          code: "SANDBOX_BOOKED",
          message: `SANDBOX booking via ${providerKey} — no real courier was contacted.`,
          ref: booked.shipmentId,
          trackingId: booked.trackingId,
        };
      } catch (e) {
        return fail(orderId, "COURIER_BOOKING_FAILED", e instanceof Error ? e.message : "Courier adapter failed.");
      }
    }

    case "tag": {
      const tag = job.tag?.trim();
      if (!tag) return fail(orderId, "TAG_REQUIRED", "tag action needs a tag value.");
      if (order.tags.includes(tag)) {
        return { orderId, ok: true, code: "TAG_ALREADY_PRESENT", message: `Tag "${tag}" already on the order.` };
      }
      await deps.orders.save({ ...order, tags: [...order.tags, tag] });
      return { orderId, ok: true, code: "TAGGED", message: `Tag "${tag}" added.` };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Executor — the future BullMQ handler body                           */
/* ------------------------------------------------------------------ */

/**
 * Process a registered job to completion, per order, in order.
 *
 * Callable three ways, all equivalent:
 *  - by the admin route right after enqueue (microtask trigger),
 *  - by the future BullMQ worker for the "bulk-actions" queue,
 *  - directly from tests with injected deps.
 *
 * Re-entry is safe: a job already RUNNING or in a terminal state is
 * returned unchanged, so an idempotent replay can never re-process.
 * Per-order failures never throw and never roll back earlier successes;
 * only an unexpected executor-level error marks the job FAILED.
 */
export async function processBulkJob(
  jobOrId: BulkJob | string,
  deps: BulkProcessDeps = {},
): Promise<BulkJob> {
  const job = typeof jobOrId === "string" ? jobsById.get(jobOrId) : jobOrId;
  if (!job) throw new Error(`Bulk job not found: ${String(jobOrId)}`);
  if (job.status !== "QUEUED") return job;

  const resolved: Required<BulkProcessDeps> = {
    orders: deps.orders ?? prismaBulkOrderStore,
    courierProviderFor: deps.courierProviderFor ?? ((name) => createSandboxCourierProvider(name)),
    now: deps.now ?? (() => new Date()),
  };

  job.status = "RUNNING";
  job.startedAt = resolved.now().toISOString();
  try {
    const results: BulkOrderResult[] = [];
    for (const orderId of job.orderIds) {
      results.push(await runForOrder(job, orderId, resolved));
    }
    job.perOrderResults = results;
    const failedCount = results.filter((r) => !r.ok).length;
    job.status = failedCount === 0 ? "COMPLETED" : "COMPLETED_WITH_FAILURES";
  } catch (e) {
    job.status = "FAILED";
    job.lastError = e instanceof Error ? e.message : "Bulk executor failed.";
  }
  job.finishedAt = resolved.now().toISOString();
  return job;
}
