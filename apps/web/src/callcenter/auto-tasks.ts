/**
 * Call-task AUTO-GENERATION — order events -> call tasks.
 *
 * Until now call tasks were created MANUALLY only (the admin POST, or
 * a supervisor adding a number). This module subscribes to the order
 * domain-event bus (src/orders/event-bus.ts) — the order-event layer,
 * NOT checkout pages — and creates the tasks the queue was designed
 * around:
 *
 *   - order.created with a fraud-review outcome -> PENDING_ORDER
 *     confirmation task. "Fraud-review outcome" = the persisted
 *     Order.riskScore lands in the manual_review (>= 40) or
 *     require_advance (>= 70) band — the exact derivation
 *     orderRowToEnriched() in src/orders/repository.ts applies, so an
 *     auto_confirm order (score < 40) gets NO task and the two modules
 *     can never disagree about what the bands mean.
 *   - order.status_changed INTO FAILED or RETURNED -> FAILED_DELIVERY
 *     rescue/follow-up task. (RETURN_REQUESTED is a customer-initiated
 *     request, not a failed delivery — no task.)
 *
 * IDEMPOTENCY (the core contract): at most ONE active (QUEUED or
 * IN_CALL) task per (orderId, kind). Re-published events, route
 * retries and double transitions all converge on that one task. A
 * completed (DONE/SKIPPED) task does NOT block a genuinely new
 * episode — an order that fails delivery twice gets a second task.
 * Creations for the same (orderId, kind) are serialized in-process so
 * two events delivered back-to-back cannot race the check-then-create.
 * Honest limit: there is no DB unique constraint backing this (a
 * partial unique index on active rows needs a raw-SQL migration —
 * reported as the schema follow-up), and the event bus itself is
 * single-process (see event-bus.ts header), so this guarantee is
 * exactly as strong as the bus's own single-node scope.
 *
 * Assignment: tasks are created UNASSIGNED (assignedToId null) — the
 * module's existing pattern is the unassigned pool + claim (G3), so
 * auto tasks flow through claimNextTaskDb like manual ones. Only the
 * MASKED phone is persisted, exactly as createManualTask does; the
 * full number resolves at read time from the linked Order.
 *
 * The module flag gates generation: while module.call_center is OFF
 * the routes 403 FEATURE_LOCKED, and this handler creates nothing.
 * The handler NEVER throws (the bus drops throwing listeners, and an
 * async rejection would be unhandled) — a failed task creation must
 * never break or mask an order mutation that already succeeded.
 */
import { prisma } from "@advance-ecommerce/db";
import { maskPhone } from "../checkout/validation";
import { subscribeOrderEvents, type DomainEvent } from "../orders/event-bus";
import { isCallCenterEnabled } from "./flags";
import { priorityForSource } from "./queue";
import type { CallQueueSource } from "./types";

/** riskScore band floor for a confirmation call: manual_review (40-69)
 *  and require_advance (>= 70) — mirrors src/orders/repository.ts. */
export const CALL_TASK_RISK_THRESHOLD = 40;

type AutoKind = Extract<CallQueueSource, "PENDING_ORDER" | "FAILED_DELIVERY">;

const FAILED_DELIVERY_INTO: ReadonlySet<string> = new Set(["FAILED", "RETURNED"]);

/* ------------------------------------------------------------------ */
/* In-process serialization per (orderId, kind)                      */
/* ------------------------------------------------------------------ */

const inflight = new Map<string, Promise<unknown>>();

function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = inflight.get(key) ?? Promise.resolve();
  const run = prior.then(fn, fn);
  inflight.set(key, run);
  // Drop the chain head once settled so the map cannot grow unbounded.
  void run.then(
    () => {
      if (inflight.get(key) === run) inflight.delete(key);
    },
    () => {
      if (inflight.get(key) === run) inflight.delete(key);
    },
  );
  return run;
}

/* ------------------------------------------------------------------ */
/* Idempotent creation                                                 */
/* ------------------------------------------------------------------ */

export type AutoCallTaskResult =
  | { created: true; taskId: string }
  | { created: false; reason: "active_task_exists" | "order_not_found" };

/**
 * Create the auto task for an order unless an ACTIVE one already
 * exists for the same (orderId, kind). Safe to call any number of
 * times for the same trigger — only the first call creates a row.
 */
export async function createAutoCallTask(
  orderId: string,
  kind: AutoKind,
): Promise<AutoCallTaskResult> {
  return serialize(`${orderId}:${kind}`, async () => {
    const existing = await prisma.callTask.findFirst({
      where: { orderId, kind, status: { in: ["QUEUED", "IN_CALL"] } },
      select: { id: true },
    });
    if (existing) return { created: false, reason: "active_task_exists" as const };

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { customerPhone: true },
    });
    if (!order) return { created: false, reason: "order_not_found" as const };

    const row = await prisma.callTask.create({
      data: {
        kind,
        priority: priorityForSource(kind),
        status: "QUEUED",
        customerPhoneMasked: maskPhone(order.customerPhone),
        orderId,
        assignedToId: null,
        attempts: 0,
      },
    });
    return { created: true, taskId: row.id };
  });
}

/* ------------------------------------------------------------------ */
/* Event handling                                                      */
/* ------------------------------------------------------------------ */

/**
 * The bus listener body. Exported for smoke tests; production delivery
 * goes through ensureCallTaskAutoGeneration(). Never throws.
 */
export async function handleOrderEventForCallTasks(event: DomainEvent): Promise<void> {
  try {
    if (!isCallCenterEnabled()) return;
    if (event.type === "order.created") {
      const order = await prisma.order.findUnique({
        where: { id: event.orderId },
        select: { riskScore: true },
      });
      if (!order) return;
      if (order.riskScore >= CALL_TASK_RISK_THRESHOLD) {
        await createAutoCallTask(event.orderId, "PENDING_ORDER");
      }
      return;
    }
    if (event.type === "order.status_changed" && FAILED_DELIVERY_INTO.has(event.to)) {
      await createAutoCallTask(event.orderId, "FAILED_DELIVERY");
    }
    // payment.succeeded: deliberately no task — a paid order's
    // confirmation need is already covered at creation time, and a
    // payment arriving must never spam the queue with a second one.
  } catch {
    // Swallowed by design — see the NEVER-THROW note in the header.
  }
}

/* ------------------------------------------------------------------ */
/* Registration (called once from instrumentation.ts)                  */
/* ------------------------------------------------------------------ */

const globalForAutoGen = globalThis as unknown as { __callTaskAutoGen?: boolean };

/** Subscribe the handler to the order event bus, exactly once per
 *  process (globalThis-guarded so dev HMR / repeated register() calls
 *  cannot stack duplicate listeners). */
export function ensureCallTaskAutoGeneration(): void {
  if (globalForAutoGen.__callTaskAutoGen) return;
  globalForAutoGen.__callTaskAutoGen = true;
  subscribeOrderEvents((event) => {
    void handleOrderEventForCallTasks(event);
  });
}
