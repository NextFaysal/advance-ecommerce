/**
 * Bulk order actions — job pipeline (Agent 63, Steps 17/22).
 *
 * Until now POST /api/v1/admin/orders (bulk) only validated + audited and
 * returned 202 QUEUED_FOR_BULK_JOB — nothing ever processed the job. This
 * module is the REAL processor: a typed job model, a job registry,
 * and `processBulkJob()`, an executor that runs the action per order
 * against the existing order store + state machine + print helpers +
 * SANDBOX courier adapter.
 *
 * Trigger model (ADV-10, doc 22 / doc 21 G3-12): the admin route
 * registers the job and calls triggerBulkJobProcessing(), which fires
 * BOTH a BullMQ dispatch onto the "bulk-actions" queue AND the
 * in-process microtask trigger. processBulkJob() claims the job
 * before executing (Redis SET NX when Redis is reachable, an
 * in-process claim set otherwise), so exactly one trigger executes
 * it — when a worker host runs, the worker's bulkActionsRunner calls
 * the same processBulkJob and the claim decides; while no worker
 * host exists, the in-process trigger does the work and the queued
 * BullMQ job later finds a terminal job and no-ops. Before ADV-10
 * the BullMQ path was broken cross-process: the registry lived only
 * in the web process's memory, so a worker in another process could
 * never find the job (BULK_JOB_NOT_FOUND). The registry is now
 * Redis-backed (below) with the in-memory map as cache + fallback.
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
 *  - The job REGISTRY is Redis-backed since ADV-10 (job JSON +
 *    idempotency index under `ae:bulk-actions:*`, 7-day TTL) with an
 *    in-memory map as the same-process cache and the fallback when
 *    Redis is absent (labelled backend "memory" — cross-process
 *    reads only work on the Redis backend). ORDER persistence is the
 *    real Prisma store by default (src/orders/repository): the
 *    default BulkOrderStore reads and writes DB Order rows, and
 *    transitions persisted through it carry their OrderStatusHistory
 *    rows. The demo store remains available for tests via
 *    demoBulkOrderStore.
 */
import { createHash, randomUUID } from "node:crypto";
import { DEFAULT_RETRY, QUEUE_NAMES, type JobRetryPolicy } from "./queues";
import { bullMqJobOptions } from "./workers";
import type { BulkActionsJob } from "./handlers";
import { findMockOrder, MOCK_ORDERS } from "../orders/mock";
import { getOrderByIdOrNo, saveOrder } from "../orders/repository";
import { computeOrderParcelWeightGrams } from "../courier/order-sync";
import { advanceConfirmBlock } from "../orders/advance";
import { discountApprovalConfirmBlockByOrderId } from "../orders/approvals";
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
 * The queue these jobs ride. It is QUEUE_NAMES.bulkActions in
 * src/jobs/queues.ts (kept as a local literal export for existing
 * importers). Retry follows DEFAULT_RETRY.
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
  /** How this job is being executed in this deployment: the route's
   *  in-process trigger ("in-process-demo") or the BullMQ worker's
   *  bulkActionsRunner ("bullmq-worker") — stamped by whichever
   *  trigger actually claims and runs it, never claimed in advance. */
  processor: "in-process-demo" | "bullmq-worker";
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
  /** Stamps BulkJob.processor when this caller executes the job
   *  (the worker's bulkActionsRunner passes "bullmq-worker"). */
  processor?: BulkJob["processor"];
}

/* ------------------------------------------------------------------ */
/* Job registry — Redis-backed store with in-memory cache/fallback     */
/* (ADV-10). The sync getters below read the in-memory map (the       */
/* same-process fast path the routes were built on); every mutation   */
/* is ALSO persisted to Redis, and the async getters read through to  */
/* Redis on a memory miss — that read-through is what lets the        */
/* worker process find a job the web process registered (and the      */
/* admin status route answer for a job another process ran). When     */
/* REDIS_URL is unset or Redis errors, the store degrades to the      */
/* in-memory map alone: backend "memory", same-process only, and      */
/* labelled as such wherever the backend is reported.                 */
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

/** Test-only reset so smoke runs start from an empty registry.
 *  Clears the in-memory maps only — Redis rows expire by TTL. */
export function clearBulkJobRegistry(): void {
  jobsById.clear();
  jobIdByIdempotencyKey.clear();
}

/* ------------------------- Redis layer ---------------------------- */

const BULK_JOB_TTL_SECONDS = 7 * 24 * 3600;
const BULK_CLAIM_TTL_SECONDS = 600;
const bulkJobKey = (id: string): string => `ae:bulk-actions:job:${id}`;
const bulkIdemKey = (key: string): string =>
  `ae:bulk-actions:idem:${createHash("sha256").update(key).digest("hex")}`;
const bulkClaimKey = (id: string): string => `ae:bulk-actions:claim:${id}`;

interface BulkRedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<string | null>;
  del(key: string): Promise<number>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

interface BulkRedisConstructorLike {
  new (url: string, options?: Record<string, unknown>): BulkRedisLike;
}

interface BulkIoRedisShape {
  default?: BulkRedisConstructorLike;
  Redis?: BulkRedisConstructorLike;
}

let bulkRedisPromise: Promise<BulkRedisLike | null> | null = null;

function getBulkRedis(): Promise<BulkRedisLike | null> {
  if (bulkRedisPromise === null) {
    bulkRedisPromise = (async () => {
      const url = process.env.REDIS_URL;
      if (url === undefined || url === "") return null;
      // Literal dynamic import, the src/lib/rate-limit.ts pattern.
      const ioredis = (await import("ioredis")) as unknown as BulkIoRedisShape;
      const Ctor = ioredis.default ?? ioredis.Redis;
      if (typeof Ctor !== "function") return null;
      const client = new Ctor(url, { maxRetriesPerRequest: 2 });
      client.on("error", () => {});
      return client;
    })();
    bulkRedisPromise.catch(() => {
      bulkRedisPromise = null;
    });
  }
  return bulkRedisPromise;
}

function resetBulkRedis(): void {
  bulkRedisPromise = null;
}

export type BulkJobStoreBackend = "redis" | "memory";

/** Which store will answer reads/writes right now — reported in the
 *  admin job-status meta so a memory answer is never dressed up as a
 *  cross-process one. */
export async function bulkJobStoreBackend(): Promise<BulkJobStoreBackend> {
  const redis = await getBulkRedis().catch(() => null);
  return redis !== null ? "redis" : "memory";
}

/** Persist a job snapshot (+ its idempotency index) to Redis.
 *  Best-effort by design: returns false when Redis is absent/down and
 *  the in-memory map remains this process's truth. Never throws. */
export async function persistBulkJob(job: BulkJob): Promise<boolean> {
  const redis = await getBulkRedis().catch(() => null);
  if (redis === null) return false;
  try {
    await redis.set(bulkJobKey(job.id), JSON.stringify(job), "EX", BULK_JOB_TTL_SECONDS);
    if (job.idempotencyKey) {
      await redis.set(bulkIdemKey(job.idempotencyKey), job.id, "EX", BULK_JOB_TTL_SECONDS);
    }
    return true;
  } catch {
    resetBulkRedis();
    return false;
  }
}

async function loadBulkJobFromRedis(id: string): Promise<BulkJob | undefined> {
  const redis = await getBulkRedis().catch(() => null);
  if (redis === null) return undefined;
  try {
    const raw = await redis.get(bulkJobKey(id));
    if (raw === null) return undefined;
    const job = JSON.parse(raw) as BulkJob;
    jobsById.set(job.id, job);
    if (job.idempotencyKey) jobIdByIdempotencyKey.set(job.idempotencyKey, job.id);
    return job;
  } catch {
    resetBulkRedis();
    return undefined;
  }
}

/** Cross-process read: memory first, Redis on a miss. This is the
 *  getter the worker's bulkActionsRunner and the admin status route
 *  use — the sync getBulkJob() above cannot see another process's
 *  registrations. */
export async function getBulkJobAsync(id: string): Promise<BulkJob | undefined> {
  return jobsById.get(id) ?? (await loadBulkJobFromRedis(id));
}

export async function findBulkJobByIdempotencyKeyAsync(
  key: string,
): Promise<BulkJob | undefined> {
  const inMemory = findBulkJobByIdempotencyKey(key);
  if (inMemory !== undefined) return inMemory;
  const redis = await getBulkRedis().catch(() => null);
  if (redis === null) return undefined;
  try {
    const id = await redis.get(bulkIdemKey(key));
    return id === null ? undefined : await getBulkJobAsync(id);
  } catch {
    resetBulkRedis();
    return undefined;
  }
}

/* ------------------------- Execution claim ------------------------ */

/**
 * Exactly-once execution claim. Two triggers can race for one job
 * (the route's in-process microtask and the BullMQ worker); the
 * claim decides. Redis SET NX when Redis is reachable — that claim
 * holds ACROSS processes. Without Redis the claim is a process-local
 * set: it still dedupes this process's own triggers, and it honestly
 * cannot exclude another process (which, without Redis, also cannot
 * receive the BullMQ dispatch — the two degradations coincide).
 */
const localClaims = new Set<string>();

async function claimBulkJob(id: string, token: string): Promise<boolean> {
  const redis = await getBulkRedis().catch(() => null);
  if (redis !== null) {
    try {
      const res = await redis.set(bulkClaimKey(id), token, "EX", BULK_CLAIM_TTL_SECONDS, "NX");
      return res === "OK";
    } catch {
      resetBulkRedis();
    }
  }
  if (localClaims.has(id)) return false;
  localClaims.add(id);
  return true;
}

async function releaseBulkJobClaim(id: string, token: string): Promise<void> {
  localClaims.delete(id);
  const redis = await getBulkRedis().catch(() => null);
  if (redis === null) return;
  try {
    // Delete only our own claim (a slow run's claim may have expired
    // and been re-taken — deleting blindly would free another
    // processor's claim).
    const current = await redis.get(bulkClaimKey(id));
    if (current === token) await redis.del(bulkClaimKey(id));
  } catch {
    resetBulkRedis();
  }
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
  // ADV-10: persist to the Redis-backed store so other processes
  // (the worker, another web instance) can find this job. Fire-and-
  // forget: registration in this process never waits on Redis, and a
  // Redis outage degrades to the memory backend, not a failed bulk
  // request. Callers that need the write landed (tests, the worker
  // path) can await persistBulkJob(job) themselves.
  void persistBulkJob(job);
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
        // Approval gate (ADV-27, doc 22): same rule as the
        // single-order funnel — a confirm whose discount share
        // reaches the configured threshold needs a manager approval
        // recorded at /admin/approvals. The guard reads the order's
        // persisted money snapshot itself and records the request
        // (requestedBy = the bulk job's requester) when it blocks.
        // Disabled in Settings = fail-open.
        const approvalBlock = await discountApprovalConfirmBlockByOrderId(orderId, job.requestedBy);
        if (approvalBlock) return fail(orderId, approvalBlock.code, approvalBlock.message);
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
          // Real parcel weight (wave 23, doc 17 batch O5): Σ Product
          // .weightGrams × quantity over the order's lines, resolved
          // live via src/courier/order-sync — a line whose product
          // carries no weight contributes that module's documented
          // 500 g-per-line default. (This replaces the invented
          // quantity × 500 g estimate this call used before.) The
          // persisted Shipment row carries the same grams
          // (Shipment.weightGrams via createShipmentRow).
          weightGrams: Math.max(100, await computeOrderParcelWeightGrams(order.items)),
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
 *  - by the BullMQ worker for the "bulk-actions" queue (its
 *    bulkActionsRunner loads the job through getBulkJobAsync),
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
  const job =
    typeof jobOrId === "string"
      ? (jobsById.get(jobOrId) ?? (await loadBulkJobFromRedis(jobOrId)))
      : jobOrId;
  if (!job) throw new Error(`Bulk job not found: ${String(jobOrId)}`);
  if (job.status !== "QUEUED") return job;

  // ADV-10 exactly-once claim: the route's in-process trigger and a
  // BullMQ worker can both arrive here for the same job; only the
  // claim holder executes. A caller that loses the claim returns the
  // freshest stored copy unchanged (the winner persists RUNNING /
  // terminal snapshots as it goes).
  const claimToken = randomUUID();
  if (!(await claimBulkJob(job.id, claimToken))) {
    return (await loadBulkJobFromRedis(job.id)) ?? job;
  }

  const resolved: Required<BulkProcessDeps> = {
    orders: deps.orders ?? prismaBulkOrderStore,
    courierProviderFor: deps.courierProviderFor ?? ((name) => createSandboxCourierProvider(name)),
    now: deps.now ?? (() => new Date()),
    processor: deps.processor ?? "in-process-demo",
  };

  try {
    job.processor = resolved.processor;
    job.status = "RUNNING";
    job.startedAt = resolved.now().toISOString();
    await persistBulkJob(job);
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
    await persistBulkJob(job);
    return job;
  } finally {
    await releaseBulkJobClaim(job.id, claimToken);
  }
}

/* ------------------------------------------------------------------ */
/* BullMQ dispatch + the route's dual trigger (ADV-10)                 */
/* ------------------------------------------------------------------ */

interface BulkQueueLike {
  add(
    name: string,
    data: BulkActionsJob,
    opts?: Record<string, unknown>,
  ): Promise<{ id?: string }>;
}

interface BulkBullMqShape {
  Queue: new (name: string, opts: { connection: unknown }) => BulkQueueLike;
}

interface BulkIoRedisCtorShape {
  default?: new (url: string, options: { maxRetriesPerRequest: null }) => unknown;
  Redis?: new (url: string, options: { maxRetriesPerRequest: null }) => unknown;
}

let bulkQueuePromise: Promise<BulkQueueLike> | null = null;

function getBulkActionsQueue(): Promise<BulkQueueLike> {
  if (bulkQueuePromise === null) {
    bulkQueuePromise = (async () => {
      const redisUrl = process.env.REDIS_URL;
      if (redisUrl === undefined || redisUrl === "") {
        throw new Error("REDIS_URL not set");
      }
      // Literal dynamic imports — never a variable specifier.
      const bullmq = (await import("bullmq")) as unknown as BulkBullMqShape;
      const ioredis = (await import("ioredis")) as unknown as BulkIoRedisCtorShape;
      const RedisCtor = ioredis.default ?? ioredis.Redis;
      if (typeof RedisCtor !== "function") throw new Error("ioredis constructor missing");
      const connection = new RedisCtor(redisUrl, { maxRetriesPerRequest: null });
      return new bullmq.Queue(QUEUE_NAMES.bulkActions, { connection });
    })();
    bulkQueuePromise.catch(() => {
      bulkQueuePromise = null;
    });
  }
  return bulkQueuePromise;
}

export type DispatchBulkJobResult =
  | { queued: true; jobId: string }
  | { queued: false; reason: string };

/**
 * Enqueue the BullMQ half of the dual trigger: a { bulkJobId } job on
 * the "bulk-actions" queue for the worker's bulkActionsRunner. The
 * BullMQ jobId derives from the bulk job id, so re-dispatching the
 * same job returns the existing queue job. Honest result: queued ===
 * true means the job sits in Redis — with no worker host running it
 * waits there, and the in-process trigger (below) is what executes
 * the job in that deployment.
 */
export async function dispatchBulkJobToQueue(
  bulkJobId: string,
  injectedQueue?: BulkQueueLike,
): Promise<DispatchBulkJobResult> {
  if (injectedQueue === undefined && (process.env.REDIS_URL === undefined || process.env.REDIS_URL === "")) {
    return { queued: false, reason: "queue-unavailable: REDIS_URL not set" };
  }
  const queueJobId = `bulk-actions-${bulkJobId}`;
  try {
    const queue = injectedQueue ?? (await getBulkActionsQueue());
    const added = await queue.add(
      "bulk-actions-job",
      { bulkJobId },
      { ...bullMqJobOptions(QUEUE_NAMES.bulkActions), jobId: queueJobId },
    );
    return { queued: true, jobId: added.id ?? queueJobId };
  } catch (error) {
    return {
      queued: false,
      reason: `queue-unavailable: ${error instanceof Error ? error.name : "unknown-error"}`,
    };
  }
}

/**
 * The admin route's trigger (ADV-10): fire BOTH execution paths —
 * the BullMQ dispatch (for the worker process, whenever a host runs
 * it) and the in-process microtask (today's executor). The claim
 * inside processBulkJob guarantees exactly one of them runs the job;
 * the loser returns the stored job unchanged. Fire-and-forget and
 * never throws: a Redis outage degrades to the in-process path alone.
 */
export function triggerBulkJobProcessing(bulkJobId: string): void {
  void dispatchBulkJobToQueue(bulkJobId).catch(() => undefined);
  queueMicrotask(() => {
    void processBulkJob(bulkJobId).catch(() => undefined);
  });
}
