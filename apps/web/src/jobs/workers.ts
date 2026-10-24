/**
 * BullMQ worker wiring — Agent 12 (workers base).
 *
 * IMPORTANT — why BullMQ is not imported here:
 * `bullmq` / `ioredis` are NOT yet dependencies of apps/web (checked:
 * no bullmq in node_modules), and this slice may not install packages.
 * So this file defines the complete wiring contract — queue -> handler,
 * retry policy, concurrency, dead-letter on final failure — against a
 * minimal structural factory interface that matches BullMQ's
 * `new Worker(name, processor, opts)` / `new Queue(name, opts)` shape.
 *
 * The separate worker entrypoint (worker deployment, NOT the Next.js
 * server) must:
 *   1. `pnpm add bullmq ioredis` in the worker package,
 *   2. create a Redis connection from REDIS_URL (server env only),
 *   3. call createWorkers(deps, { Worker, Queue }, connection)
 *      with the real BullMQ constructors,
 *   4. keep the process running and handle SIGTERM via workers.close().
 * Until that entrypoint exists, these workers do NOT run — this file is
 * the tested wiring + policy layer, not a running daemon. Do not claim
 * otherwise.
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

export interface WorkerRuntimeDeps extends HandlerDeps {
  idempotencyStore?: IdempotencyStore;
  deadLetterSink?: DeadLetterSink;
}

function errorCodeOf(error: unknown): string {
  if (error instanceof Error) {
    const firstToken = error.message.split(":")[0]?.trim();
    return firstToken !== undefined && firstToken !== "" ? firstToken : error.name;
  }
  return "UNKNOWN_ERROR";
}

export function createProcessor<TPayload>(
  queue: QueueName,
  runtime: Required<Pick<WorkerRuntimeDeps, "idempotencyStore" | "deadLetterSink">> &
    HandlerDeps,
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
  const fullRuntime: Required<Pick<WorkerRuntimeDeps, "idempotencyStore" | "deadLetterSink">> &
    HandlerDeps = {
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
