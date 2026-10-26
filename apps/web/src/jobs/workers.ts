/**
 * BullMQ worker wiring — Agent 12 (workers base).
 *
 * Why BullMQ is not statically imported here: `bullmq` / `ioredis`
 * ARE dependencies of apps/web (package.json), but this module keeps
 * to a structural factory interface — createWorkers(runtime, factory,
 * connection) receives the real BullMQ `Worker` constructor from its
 * caller — so the wiring (queue -> handler, retry policy, concurrency,
 * dead-letter on final failure) stays unit-testable without a live
 * Redis, and the Next.js server bundle never pulls in worker-only code.
 *
 * The worker entrypoint EXISTS: apps/web/scripts/worker.ts, run with
 * `pnpm --filter web worker`. It dynamically loads bullmq/ioredis,
 * creates the Redis connection from REDIS_URL (server env only),
 * assembles the real handler deps (src/jobs/worker-deps.ts), calls
 * createWorkers(...) with the real BullMQ constructor, keeps the
 * process running and handles SIGTERM via workers.close().
 *
 * Whether a daemon is actually RUNNING is a deployment fact, not a
 * property of this file: production has no worker host yet (doc 21
 * G2 — the VPS lands after development completes), so until a host
 * runs the entrypoint, queued jobs wait in Redis unconsumed. Do not
 * claim otherwise.
 *
 * Retry / dead-letter policy:
 *  - Job options use the policies in queues.ts: DEFAULT_RETRY
 *    (3 attempts, 30s exponential-style backoff) for most queues,
 *    COURIER_RETRY (5 attempts, 60s) for courier booking/sync.
 *  - When attemptsMade reaches the policy maximum and the handler still
 *    throws, the processor records a DeadLetterEntry (ids/refs only)
 *    via the injected DeadLetterSink and rethrows, so BullMQ marks the
 *    job failed and it stays inspectable / manually replayable in admin
 *    (manual fallback, Step 34) instead of vanishing.
 */
import {
  COURIER_RETRY,
  DEFAULT_RETRY,
  QUEUE_NAMES,
  type JobRetryPolicy,
  type QueueName,
} from "./queues";
import {
  createHandlers,
  InMemoryDeadLetterSink,
  InMemoryIdempotencyStore,
  type DeadLetterSink,
  type HandlerDeps,
  type HandlerResult,
  type IdempotencyStore,
  type JobEnvelope,
} from "./handlers";

/* ------------------------------------------------------------------ */
/* Retry policy per queue                                              */
/* ------------------------------------------------------------------ */

export const RETRY_POLICY_BY_QUEUE: Record<QueueName, JobRetryPolicy> = {
  [QUEUE_NAMES.sms]: DEFAULT_RETRY,
  [QUEUE_NAMES.email]: DEFAULT_RETRY,
  [QUEUE_NAMES.courierBooking]: COURIER_RETRY,
  [QUEUE_NAMES.courierSync]: COURIER_RETRY,
  [QUEUE_NAMES.webhook]: DEFAULT_RETRY,
  [QUEUE_NAMES.importExport]: DEFAULT_RETRY,
  [QUEUE_NAMES.report]: DEFAULT_RETRY,
  [QUEUE_NAMES.notificationRetry]: DEFAULT_RETRY,
  [QUEUE_NAMES.abandonedCart]: DEFAULT_RETRY,
  [QUEUE_NAMES.automation]: DEFAULT_RETRY,
  [QUEUE_NAMES.bulkActions]: DEFAULT_RETRY,
  [QUEUE_NAMES.subscriptions]: DEFAULT_RETRY,
};

export const CONCURRENCY_BY_QUEUE: Record<QueueName, number> = {
  [QUEUE_NAMES.sms]: 5,
  [QUEUE_NAMES.email]: 5,
  [QUEUE_NAMES.courierBooking]: 3,
  [QUEUE_NAMES.courierSync]: 3,
  [QUEUE_NAMES.webhook]: 5,
  [QUEUE_NAMES.importExport]: 1,
  [QUEUE_NAMES.report]: 1,
  [QUEUE_NAMES.notificationRetry]: 3,
  [QUEUE_NAMES.abandonedCart]: 2,
  [QUEUE_NAMES.automation]: 2,
  [QUEUE_NAMES.bulkActions]: 1,
  [QUEUE_NAMES.subscriptions]: 1,
};

/** BullMQ-shaped job options derived from the retry policy. */
export function bullMqJobOptions(queue: QueueName): {
  attempts: number;
  backoff: { type: "exponential"; delay: number };
  removeOnComplete: number;
  removeOnFail: boolean;
} {
  const policy = RETRY_POLICY_BY_QUEUE[queue];
  return {
    attempts: policy.attempts,
    backoff: { type: "exponential", delay: policy.backoffSeconds * 1000 },
    removeOnComplete: 1000,
    // Never auto-remove failed jobs: they are the dead-letter audit trail.
    removeOnFail: false,
  };
}

/* ------------------------------------------------------------------ */
/* Structural BullMQ surface (matches the real API subset we use)      */
/* ------------------------------------------------------------------ */

export interface BullMqJobLike<TPayload = unknown> {
  id?: string;
  name: string;
  data: TPayload;
  attemptsMade: number;
  opts: { attempts?: number };
}

export interface BullMqWorkerLike {
  close(): Promise<void>;
  on(event: "failed" | "completed" | "error", listener: (...args: never[]) => void): unknown;
}

export interface BullMqWorkerConstructor {
  new <TPayload>(
    queueName: string,
    processor: (job: BullMqJobLike<TPayload>) => Promise<HandlerResult>,
    options: { connection: unknown; concurrency: number },
  ): BullMqWorkerLike;
}

export interface BullMqFactory {
  Worker: BullMqWorkerConstructor;
}

/* ------------------------------------------------------------------ */
/* Processor factory: envelope -> handler, dead-letter on final fail */
/* ------------------------------------------------------------------ */

/** One exhausted call-center automation job, as handed to the
 *  timeline hook below (ids/refs only — never a phone number). */
export interface CallCenterDeadLetterInfo {
  /** BullMQ job id (for these jobs = the producer's idempotency key). */
  jobId: string;
  /** SmsJob.automationKind: NO_ANSWER_SMS / CALLBACK_REMINDER_SMS / RESCUE_SMS. */
  automationKind?: string;
  /** SmsJob.taskId — the CallTask the automation belongs to. */
  taskId?: string;
  /** SmsJob.orderId — fallback timeline target when no task resolves. */
  orderId?: string;
  /** Total attempts made (attemptsMade + 1 at the final failure). */
  attempts: number;
  /** Error class/code only, same convention as DeadLetterEntry. */
  errorCode: string;
}

export interface WorkerRuntimeDeps extends HandlerDeps {
  idempotencyStore?: IdempotencyStore;
  deadLetterSink?: DeadLetterSink;
  /**
   * Doc 18 F1: timeline hook fired ONLY when a call-center automation
   * SMS job (sms queue, payload jobKind "callcenter-automation")
   * exhausts its retries — in the same final-attempt branch that
   * records the DeadLetterEntry. The worker deps assembly wires it to
   * src/callcenter/dead-letter.ts, which leaves an AUTO_SMS_DEAD_LETTER
   * row on the task (or an OrderNote on the order) so staff see the
   * automation gave up instead of silence. Absent outside the worker
   * process, where the hook simply never fires.
   */
  callCenterDeadLetter?: (info: CallCenterDeadLetterInfo) => Promise<void>;
}

/** The runtime shape createProcessor consumes: the two stores are
 *  guaranteed present (createWorkers defaults them), the rest of the
 *  handler deps + the optional dead-letter hook pass through. */
type ProcessorRuntime = Required<
  Pick<WorkerRuntimeDeps, "idempotencyStore" | "deadLetterSink">
> &
  HandlerDeps &
  Pick<WorkerRuntimeDeps, "callCenterDeadLetter">;

function errorCodeOf(error: unknown): string {
  if (error instanceof Error) {
    const firstToken = error.message.split(":")[0]?.trim();
    return firstToken !== undefined && firstToken !== "" ? firstToken : error.name;
  }
  return "UNKNOWN_ERROR";
}

export function createProcessor<TPayload>(
  queue: QueueName,
  runtime: ProcessorRuntime,
): (job: BullMqJobLike<TPayload & { idempotencyKey?: string }>) => Promise<HandlerResult> {
  const handlers = createHandlers(runtime, runtime.idempotencyStore);
  const handler = handlers[queue];
  const policy = RETRY_POLICY_BY_QUEUE[queue];

  return async (job) => {
    const envelope: JobEnvelope<TPayload> = {
      jobId: job.id ?? `${queue}:unknown`,
      idempotencyKey:
        typeof job.data?.idempotencyKey === "string"
          ? job.data.idempotencyKey
          : `${queue}:${job.id ?? "unknown"}`,
      attemptsMade: job.attemptsMade,
      payload: job.data,
    };
    try {
      return await handler(envelope as JobEnvelope<never>);
    } catch (error) {
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? policy.attempts);
      if (isFinalAttempt) {
        await runtime.deadLetterSink.record({
          queue,
          jobId: envelope.jobId,
          idempotencyKey: envelope.idempotencyKey,
          errorCode: errorCodeOf(error),
          attempts: job.attemptsMade + 1,
          failedAt: new Date().toISOString(),
          payloadRef: envelope.idempotencyKey,
        });
        // Doc 18 F1: a call-center automation job that exhausts its
        // retries ALSO leaves a row on the task/order timeline (via
        // the injected hook) — the DeadLetterEntry above is the
        // system of record, but staff work from the task timeline,
        // where silence reads as "still waiting". Scoped strictly to
        // the sms queue + jobKind "callcenter-automation"; every
        // other queue/kind records only the DeadLetterEntry.
        // Best-effort: a timeline write failure must never mask the
        // job's own error or change BullMQ's failure handling.
        if (queue === QUEUE_NAMES.sms && runtime.callCenterDeadLetter !== undefined) {
          const data = (job.data ?? {}) as unknown as Record<string, unknown>;
          if (data.jobKind === "callcenter-automation") {
            try {
              await runtime.callCenterDeadLetter({
                jobId: envelope.jobId,
                automationKind:
                  typeof data.automationKind === "string" ? data.automationKind : undefined,
                taskId: typeof data.taskId === "string" ? data.taskId : undefined,
                orderId: typeof data.orderId === "string" ? data.orderId : undefined,
                attempts: job.attemptsMade + 1,
                errorCode: errorCodeOf(error),
              });
            } catch {
              // The DeadLetterEntry above already recorded the
              // failure; the timeline row is an audit nicety on top.
            }
          }
        }
      }
      throw error;
    }
  };
}

/* ------------------------------------------------------------------ */
/* Worker assembly                                                     */
/* ------------------------------------------------------------------ */

export interface CreatedWorkers {
  queues: QueueName[];
  workers: BullMqWorkerLike[];
  close(): Promise<void>;
}

/**
 * Build one Worker per queue. `connection` is the worker entrypoint's
 * Redis connection object (ioredis) — passed as unknown so this file
 * never imports a Redis client. See the header for deployment steps.
 */
export function createWorkers(
  runtime: WorkerRuntimeDeps,
  factory: BullMqFactory,
  connection: unknown,
): CreatedWorkers {
  const fullRuntime: ProcessorRuntime = {
    ...runtime,
    idempotencyStore: runtime.idempotencyStore ?? new InMemoryIdempotencyStore(),
    deadLetterSink: runtime.deadLetterSink ?? new InMemoryDeadLetterSink(),
  };
  const queues = Object.values(QUEUE_NAMES) as QueueName[];
  const workers = queues.map((queue) => {
    const processor = createProcessor(queue, fullRuntime);
    return new factory.Worker(queue, processor, {
      connection,
      concurrency: CONCURRENCY_BY_QUEUE[queue],
    });
  });
  return {
    queues,
    workers,
    async close() {
      await Promise.all(workers.map(async (w) => w.close()));
    },
  };
}

/** Queue names + policies, for the worker entrypoint / admin health page. */
export function workerManifest(): {
  queue: QueueName;
  attempts: number;
  backoffSeconds: number;
  concurrency: number;
}[] {
  return (Object.values(QUEUE_NAMES) as QueueName[]).map((queue) => ({
    queue,
    attempts: RETRY_POLICY_BY_QUEUE[queue].attempts,
    backoffSeconds: RETRY_POLICY_BY_QUEUE[queue].backoffSeconds,
    concurrency: CONCURRENCY_BY_QUEUE[queue],
  }));
}
