/**
 * Automation lifecycle producers — ADV-7 (doc 22).
 *
 * Until this module existed, the automation engine was evaluated ONLY
 * when an admin POSTed a sample event to the runs route: nothing in
 * the order / checkout / inventory funnels ever told it that real
 * life happened. emitAutomationEvent() is the one producer seam the
 * funnels call (post-commit, ids only):
 *
 *   order.created        <- orders/repository createOrderRecord
 *   order.status_changed <- orders/repository applyOrderTransition
 *                           (DELIVERED / CANCELLED automations match
 *                           on this same event's orderStatus — the
 *                           engine has no separate delivered/cancelled
 *                           triggers, and rules condition on status)
 *   payment.succeeded    <- orders/repository markOrderPayment
 *                           (only on the transition INTO PAID)
 *   checkout.abandoned   <- checkout/abandoned captureAbandonedCheckout
 *                           (NEW captures only — a session's debounced
 *                           refresh posts never re-fire)
 *   stock.low            <- inventory/repository applyMovementDb
 *                           (a movement that DECREASES availability to
 *                           at/below the variant's low-stock threshold)
 *
 * customer.registered is deliberately NOT dispatched: the engine's
 * trigger vocabulary is the DB AutomationTrigger enum (ORDER_CREATED /
 * ORDER_STATUS_CHANGED / PAYMENT_SUCCEEDED / STOCK_LOW /
 * CHECKOUT_ABANDONED) and it has no customer value — rules could not
 * be created for it and run logs could not persist its evaluations.
 * Adding it needs a Prisma enum migration, which is a schema wave's
 * call, not this module's.
 *
 * Contract (mirrors the delivered-hooks / return-notify producers):
 *  - NEVER throws into the caller. A funnel that already committed
 *    must not fail because automation hiccuped; every failure is a
 *    returned outcome + a warn log carrying ids only.
 *  - Flag-gated: the module.automation paid add-on stays dark unless
 *    its flag is ON — a locked module enqueues nothing (the admin
 *    routes' fail-closed rule, applied to producers).
 *  - One automation-run job per ENABLED rule on the trigger, payload
 *    { workflowId: ruleId, triggerEvent, entityId } — the runner
 *    re-loads the entity at execution time, so delayed rules evaluate
 *    current state, not emit-time state. The BullMQ jobId is
 *    deterministic per (rule, entity, dedupeSuffix) so a retried
 *    funnel call cannot double-dispatch while the job is queued.
 */
import { QUEUE_NAMES } from "../jobs/queues";
import type { AutomationJob as AutomationJobPayload } from "../jobs/handlers";
import { bullMqJobOptions } from "../jobs/workers";
import { automationStore, type AutomationStore } from "./store";
import type { AutomationTrigger } from "./types";

/* ------------------------------------------------------------------ */
/* Queue producer — bullmq / ioredis load dynamically (the             */
/* return-notify.ts pattern) so importing this module never hard-      */
/* fails a request path when the queue stack is unavailable.           */
/* ------------------------------------------------------------------ */

interface AutomationQueueLike {
  add(name: string, data: AutomationJobPayload, opts: Record<string, unknown>): Promise<{ id?: string }>;
}

interface BullMqProducerShape {
  Queue: new (name: string, opts: { connection: unknown }) => AutomationQueueLike;
}

interface RedisConstructorLike {
  new (url: string, options: { maxRetriesPerRequest: null }): unknown;
}

interface IoRedisShape {
  default?: RedisConstructorLike;
  Redis?: RedisConstructorLike;
}

async function loadBullMq(): Promise<BullMqProducerShape> {
  return (await import("bullmq")) as unknown as BullMqProducerShape;
}

async function loadIoRedis(): Promise<IoRedisShape> {
  return (await import("ioredis")) as unknown as IoRedisShape;
}

let automationQueuePromise: Promise<AutomationQueueLike> | null = null;

function getAutomationQueue(): Promise<AutomationQueueLike> {
  if (automationQueuePromise === null) {
    automationQueuePromise = (async () => {
      const redisUrl = process.env.REDIS_URL;
      if (redisUrl === undefined || redisUrl === "") {
        throw new Error("REDIS_URL not set");
      }
      const bullmq = await loadBullMq();
      const ioredis = await loadIoRedis();
      const RedisCtor = ioredis.default ?? ioredis.Redis;
      if (typeof RedisCtor !== "function") throw new Error("ioredis constructor missing");
      const connection = new RedisCtor(redisUrl, { maxRetriesPerRequest: null });
      return new bullmq.Queue(QUEUE_NAMES.automation, { connection });
    })();
    automationQueuePromise.catch(() => {
      automationQueuePromise = null;
    });
  }
  return automationQueuePromise;
}

/**
 * Enqueue ONE automation-run job. Returns false (never throws) when
 * the queue is unavailable — the caller decides how loud to be.
 * `delaySeconds` > 0 rides BullMQ's native delay (the scheduled-rule
 * re-invocation path in the automation runner).
 */
export async function enqueueAutomationJob(
  job: AutomationJobPayload,
  opts: { jobId?: string; delaySeconds?: number } = {},
): Promise<boolean> {
  if (process.env.REDIS_URL === undefined || process.env.REDIS_URL === "") return false;
  try {
    const queue = await getAutomationQueue();
    await queue.add("automation-event", job, {
      ...bullMqJobOptions(QUEUE_NAMES.automation),
      ...(opts.jobId ? { jobId: opts.jobId } : {}),
      ...(opts.delaySeconds && opts.delaySeconds > 0
        ? { delay: opts.delaySeconds * 1000 }
        : {}),
    });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

export interface AutomationProducerDeps {
  store?: AutomationStore;
  enqueue?: (job: AutomationJobPayload, jobId: string) => Promise<boolean>;
  /** module.automation flag read; default = the unified DB flag store. */
  flagEnabled?: () => Promise<boolean>;
}

export interface AutomationDispatchResult {
  /** automation-run jobs actually enqueued. */
  dispatched: number;
  skipped?: "flag_disabled" | "no_rules" | "queue_unavailable" | "error";
}

async function defaultFlagEnabled(): Promise<boolean> {
  try {
    const db = await import("../lib/feature-flags-db");
    await db.ensureDbFeatureFlags();
    const flags = await import("../lib/feature-flags");
    return flags.featureFlags.isFeatureEnabled("module.automation");
  } catch {
    // Fail-closed: a paid add-on never runs because a flag read broke.
    return false;
  }
}

/**
 * Fan one lifecycle event out to the enabled rules on its trigger.
 * Fire-and-forget by contract: funnel callers `await` this (it is
 * fast: one flag read, one rule list, N queue adds) but it can never
 * throw into them.
 */
export async function emitAutomationEvent(
  trigger: AutomationTrigger,
  entityId: string,
  opts: { dedupeSuffix?: string; deps?: AutomationProducerDeps } = {},
): Promise<AutomationDispatchResult> {
  try {
    const deps = opts.deps ?? {};
    const flagEnabled = deps.flagEnabled ?? defaultFlagEnabled;
    if (!(await flagEnabled())) return { dispatched: 0, skipped: "flag_disabled" };

    const store = deps.store ?? automationStore;
    const rules = (await store.listRules()).filter(
      (rule) => rule.enabled && rule.trigger === trigger,
    );
    if (rules.length === 0) return { dispatched: 0, skipped: "no_rules" };

    const enqueue =
      deps.enqueue ??
      ((job: AutomationJobPayload, jobId: string) => enqueueAutomationJob(job, { jobId }));
    let dispatched = 0;
    let anyFailed = false;
    for (const rule of rules) {
      const jobId =
        `automation-${rule.id}-${entityId}` +
        (opts.dedupeSuffix ? `-${opts.dedupeSuffix}` : "");
      const ok = await enqueue(
        { workflowId: rule.id, triggerEvent: trigger, entityId },
        jobId,
      );
      if (ok) dispatched += 1;
      else anyFailed = true;
    }
    if (dispatched === 0 && anyFailed) return { dispatched: 0, skipped: "queue_unavailable" };
    return { dispatched };
  } catch (error) {
    // Ids and codes only — never payload data (the phone lives on the
    // entity row, not in this call).
    console.warn("[automation] emit failed", {
      trigger,
      entityId,
      error: error instanceof Error ? error.name : "unknown-error",
    });
    return { dispatched: 0, skipped: "error" };
  }
}
