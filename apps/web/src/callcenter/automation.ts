/**
 * Call-center follow-up automation — C4 (plan doc 14, §C4).
 *
 * Two halves, deliberately separated:
 *
 *  DECISION (web process, called by the outcome route right after
 *  recordOutcomeDb persists a human outcome): pure rule evaluation +
 *  scheduling side effects — retry backoff on the task
 *  (CallTask.nextAttemptAt) and delayed SMS jobs on the EXISTING sms
 *  queue (QUEUE_NAMES.sms, jobKind "callcenter-automation"). Every
 *  decision is written to the task's CallLogEntry timeline as an
 *  AUTO_SMS_SCHEDULED / AUTO_SMS_SKIPPED row (agentId null) so the
 *  automation is visible per task, per the C4 acceptance criteria.
 *
 *  SEND (worker process, via HandlerDeps.callCenterSmsSend wired in
 *  src/jobs/worker-deps.ts): when a delayed job fires, the send path
 *  RE-CHECKS everything that could have changed since scheduling —
 *  the kill switch, the module flag, whether a human has since
 *  handled the task, whether the task was force-closed, and whether
 *  a full phone number is resolvable — then sends through the SAME
 *  SMS adapter resolver the rest of the platform uses and records
 *  AUTO_SMS_SENT / AUTO_SMS_SKIPPED with the adapter's honest result.
 *  A sandbox adapter result is labelled sandbox in the timeline; this
 *  module never claims a real SMS left the system when it did not.
 *
 * KILL SWITCH: flag `module.call_center_automation` (seeded OFF),
 * checked at decision time AND again at send time — flipping it OFF
 * stops new decisions instantly and makes already-queued jobs log
 * AUTO_SMS_SKIPPED instead of sending.
 *
 * CONFIRMED dedupe: a CONFIRMED call outcome deliberately schedules
 * NO call-center SMS. The order-confirmation SMS is owned by the
 * order flow (the automation engine's send_sms effect over the same
 * queues + the notification log / retry pipeline); if the call
 * center also sent one, the customer would receive two messages for
 * one confirmation once both systems are live. Instead the decision
 * writes a timeline note ("covered-by-order-sms") explaining the
 * absence, so the audit trail shows the dedupe was intentional.
 *
 * Payload discipline (queues.ts contract): jobs carry ids only —
 * taskId + the decision log id — never a phone number. The number is
 * resolved from the DB at send time (linked Order, or a MANUAL
 * task's stored number), exactly like the read-time view gate.
 *
 * Timeline outcomes are a SEPARATE union from the human CallOutcome
 * (types.ts stays the closed human contract — the same pattern the
 * C2 supervisor actions use when they write REASSIGNED / RELEASED /
 * FORCE_CLOSED rows into the same free-String outcome column).
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import { ensureDbFeatureFlags } from "../lib/feature-flags-db";
import { getSetting } from "../lib/settings";
import type { SmsProvider } from "../integrations/sms";
import { QUEUE_NAMES, type SmsJob } from "../jobs/queues";
import { bullMqJobOptions } from "../jobs/workers";
import type { HandlerResult } from "../jobs/handlers";
import { isCallCenterAutomationEnabled } from "./flags";
import { loadCallTask, type DbCallTask } from "./store";
import type { CallOutcome } from "./types";

/* ------------------------------------------------------------------ */
/* Timeline outcomes + SMS kinds                                       */
/* ------------------------------------------------------------------ */

export const AUTOMATION_LOG_OUTCOMES = [
  "AUTO_SMS_SCHEDULED",
  "AUTO_SMS_SENT",
  "AUTO_SMS_SKIPPED",
] as const;
export type AutomationLogOutcome = (typeof AUTOMATION_LOG_OUTCOMES)[number];

export const AUTOMATION_SMS_KINDS = [
  "NO_ANSWER_SMS",
  "CALLBACK_REMINDER_SMS",
  "RESCUE_SMS",
] as const;
export type AutomationSmsKind = (typeof AUTOMATION_SMS_KINDS)[number];

const TEMPLATE_KEYS: Record<AutomationSmsKind, string> = {
  NO_ANSWER_SMS: "callcenter.no_answer",
  CALLBACK_REMINDER_SMS: "callcenter.callback_reminder",
  RESCUE_SMS: "callcenter.rescue",
};

/* ------------------------------------------------------------------ */
/* Asia/Dhaka wall-clock helpers (pure)                                */
/* ------------------------------------------------------------------ */

const DHAKA_TZ = "Asia/Dhaka";
const dhakaFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: DHAKA_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

interface DhakaParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function dhakaParts(date: Date): DhakaParts {
  const parts = dhakaFormat.formatToParts(date);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** The UTC instant at which Dhaka wall-clock reads (y/m/d h:mi:00). */
function dhakaWallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const p = dhakaParts(new Date(guess));
    const rendered = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = target - rendered;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

function nextDhakaDay(p: DhakaParts): { year: number; month: number; day: number } {
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

/**
 * Clamp an instant into the legal calling window [startHour, endHour)
 * Asia/Dhaka: before the window -> same Dhaka day at startHour; at or
 * after the window end -> next Dhaka day at startHour; inside -> the
 * instant unchanged.
 */
export function clampToCallingHours(date: Date, startHour: number, endHour: number): Date {
  const p = dhakaParts(date);
  if (p.hour < startHour) {
    return dhakaWallToUtc(p.year, p.month, p.day, startHour, 0);
  }
  if (p.hour >= endHour) {
    const next = nextDhakaDay(p);
    return dhakaWallToUtc(next.year, next.month, next.day, startHour, 0);
  }
  return date;
}

/**
 * No-answer retry schedule by attempt count (the count AFTER the
 * outcome was recorded): attempt 1 -> +30 minutes, attempt 2 -> +2
 * hours, attempt 3+ -> next Dhaka day at 10:00. The result is always
 * clamped into the calling window. (With MAX_ATTEMPTS = 3 the task
 * closes on attempt 3, so the decision layer only persists tiers 1–2
 * today; tier 3 is defined so a future MAX_ATTEMPTS raise inherits
 * the intended policy.)
 */
export function computeRetryAt(
  now: Date,
  attemptsAfterOutcome: number,
  calling: { startHour: number; endHour: number },
): Date {
  let candidate: Date;
  if (attemptsAfterOutcome <= 1) {
    candidate = new Date(now.getTime() + 30 * 60_000);
  } else if (attemptsAfterOutcome === 2) {
    candidate = new Date(now.getTime() + 2 * 3_600_000);
  } else {
    const next = nextDhakaDay(dhakaParts(now));
    candidate = dhakaWallToUtc(next.year, next.month, next.day, 10, 0);
  }
  return clampToCallingHours(candidate, calling.startHour, calling.endHour);
}

/* ------------------------------------------------------------------ */
/* SMS templates (pure)                                                */
/* ------------------------------------------------------------------ */

export interface AutomationSmsContext {
  customerName: string;
  orderNo?: string;
  storeName: string;
  /** ISO time of the scheduled callback (reminder SMS). */
  callbackAt?: string;
  /** Public tracking page URL (rescue SMS). */
  trackUrl: string;
}

function bnTime(iso: string): string {
  return new Date(iso).toLocaleString("bn-BD", {
    timeZone: DHAKA_TZ,
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Render the Bangla SMS body for an automation kind. No phone
 *  numbers are ever interpolated — order number + public links only. */
export function renderAutomationSms(kind: AutomationSmsKind, ctx: AutomationSmsContext): string {
  const store = ctx.storeName.trim();
  const fromStore = store ? `আমরা ${store} থেকে` : "আমরা";
  const orderPart = ctx.orderNo ? ` (অর্ডার নম্বর: ${ctx.orderNo})` : "";
  switch (kind) {
    case "NO_ANSWER_SMS":
      return (
        `আসসালামু আলাইকুম, ${fromStore} আপনার অর্ডার${orderPart} নিশ্চিত করতে কল করেছিলাম, ` +
        `কিন্তু যোগাযোগ করা যায়নি। আমরা আবার চেষ্টা করব — অনুগ্রহ করে ফোনটি হাতের কাছে রাখবেন। ধন্যবাদ।`
      );
    case "CALLBACK_REMINDER_SMS":
      return (
        `আসসালামু আলাইকুম, আপনার অনুরোধ অনুযায়ী ${ctx.callbackAt ? `আজ ${bnTime(ctx.callbackAt)}-এ ` : ""}` +
        `${fromStore} আবার কল করব${ctx.orderNo ? ` (অর্ডার নম্বর: ${ctx.orderNo})` : ""}। অনুগ্রহ করে প্রস্তুত থাকবেন। ধন্যবাদ।`
      );
    case "RESCUE_SMS":
      return (
        `দুঃখিত, আপনার অর্ডার${orderPart} ডেলিভারি সম্পন্ন করা যায়নি। নতুন সময় ঠিক করতে আমরা শীঘ্রই কল করব। ` +
        `অর্ডারের অবস্থা দেখুন: ${ctx.trackUrl}${ctx.orderNo ? ` (অর্ডার নম্বর: ${ctx.orderNo})` : ""}`
      );
  }
}

/* ------------------------------------------------------------------ */
/* Settings (fail-soft: a bad/missing value falls back to the default) */
/* ------------------------------------------------------------------ */

async function intSetting(key: string, fallback: number, min: number, max: number): Promise<number> {
  try {
    const raw = await getSetting(key);
    const n = raw === null ? NaN : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  } catch {
    return fallback;
  }
}

async function storeNameSetting(): Promise<string> {
  try {
    return (await getSetting("general.store_name")) ?? "";
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ */
/* Timeline rows                                                       */
/* ------------------------------------------------------------------ */

async function writeAutomationLog(
  id: string,
  taskId: string,
  outcome: AutomationLogOutcome,
  note: string,
): Promise<void> {
  await prisma.callLogEntry.create({
    data: { id, taskId, agentId: null, outcome, note },
  });
}

/* ------------------------------------------------------------------ */
/* Producer: delayed SMS jobs on the EXISTING sms queue.               */
/* bullmq / ioredis load dynamically (the scripts/worker.ts pattern)  */
/* so this module never hard-fails a request path when the queue      */
/* stack is unavailable — enqueue failure is a decision outcome,      */
/* recorded on the timeline as AUTO_SMS_SKIPPED, never thrown.        */
/* ------------------------------------------------------------------ */

interface SmsQueueLike {
  add(
    name: string,
    data: SmsJob,
    opts: Record<string, unknown>,
  ): Promise<{ id?: string }>;
}

interface BullMqProducerShape {
  Queue: new (name: string, opts: { connection: unknown }) => SmsQueueLike;
}

interface RedisConstructorLike {
  new (url: string, options: { maxRetriesPerRequest: null }): unknown;
}

interface IoRedisShape {
  default?: RedisConstructorLike;
  Redis?: RedisConstructorLike;
}

/**
 * Literal dynamic imports (never a variable specifier — the Next.js
 * server bundler cannot resolve those at runtime; the variable form
 * silently degraded every enqueue to "queue-unavailable" in the built
 * app while working under tsx). bullmq/ioredis are listed in
 * next.config serverExternalPackages, so these stay runtime requires.
 */
async function loadBullMq(): Promise<BullMqProducerShape> {
  return (await import("bullmq")) as unknown as BullMqProducerShape;
}

async function loadIoRedis(): Promise<IoRedisShape> {
  return (await import("ioredis")) as unknown as IoRedisShape;
}

let smsQueuePromise: Promise<SmsQueueLike> | null = null;

function getSmsQueue(): Promise<SmsQueueLike> {
  if (smsQueuePromise === null) {
    smsQueuePromise = (async () => {
      const redisUrl = process.env.REDIS_URL;
      if (redisUrl === undefined || redisUrl === "") {
        throw new Error("REDIS_URL not set");
      }
      const bullmq = await loadBullMq();
      const ioredis = await loadIoRedis();
      const RedisCtor = ioredis.default ?? ioredis.Redis;
      if (typeof RedisCtor !== "function") throw new Error("ioredis constructor missing");
      const connection = new RedisCtor(redisUrl, { maxRetriesPerRequest: null });
      return new bullmq.Queue(QUEUE_NAMES.sms, { connection });
    })();
    // A failed construction must not poison the process — the next
    // outcome retries (e.g. after REDIS_URL appears).
    smsQueuePromise.catch(() => {
      smsQueuePromise = null;
    });
  }
  return smsQueuePromise;
}

type EnqueueResult =
  | { enqueued: true; jobId: string }
  | { enqueued: false; reason: string };

async function enqueueAutomationSms(job: SmsJob, runAt: Date): Promise<EnqueueResult> {
  if (process.env.REDIS_URL === undefined || process.env.REDIS_URL === "") {
    return { enqueued: false, reason: "queue-unavailable: REDIS_URL not set" };
  }
  try {
    const queue = await getSmsQueue();
    const delay = Math.max(0, runAt.getTime() - Date.now());
    const added = await queue.add("callcenter-automation-sms", job, {
      ...bullMqJobOptions(QUEUE_NAMES.sms),
      // The stable idempotency key doubles as the BullMQ jobId: a
      // replayed enqueue returns the existing job instead of a copy.
      jobId: job.idempotencyKey,
      delay,
    });
    return { enqueued: true, jobId: added.id ?? (job.idempotencyKey as string) };
  } catch (error) {
    return {
      enqueued: false,
      reason: `queue-unavailable: ${error instanceof Error ? error.name : "unknown-error"}`,
    };
  }
}

async function scheduleSms(
  task: DbCallTask,
  kind: AutomationSmsKind,
  runAt: Date,
): Promise<AutomationAction> {
  const decisionLogId = randomUUID();
  const idempotencyKey = `callcenter-auto-${task.id}-${kind}-${decisionLogId}`;
  const job: SmsJob = {
    jobKind: "callcenter-automation",
    automationKind: kind,
    taskId: task.id,
    decisionLogId,
    runAt: runAt.toISOString(),
    templateKey: TEMPLATE_KEYS[kind],
    recipientRef: `calltask-${task.id}`,
    orderId: task.orderId,
    idempotencyKey,
  };
  const result = await enqueueAutomationSms(job, runAt);
  if (result.enqueued) {
    await writeAutomationLog(
      decisionLogId,
      task.id,
      "AUTO_SMS_SCHEDULED",
      `${kind} scheduled for ${runAt.toISOString()} (queue job ${result.jobId}). decision:${decisionLogId}`,
    );
    return {
      kind: "sms-scheduled",
      automationKind: kind,
      runAt: runAt.toISOString(),
      enqueued: true,
      detail: `queued as job ${result.jobId}`,
    };
  }
  await writeAutomationLog(
    decisionLogId,
    task.id,
    "AUTO_SMS_SKIPPED",
    `${kind} was NOT enqueued: ${result.reason}. decision:${decisionLogId}`,
  );
  return {
    kind: "sms-scheduled",
    automationKind: kind,
    runAt: runAt.toISOString(),
    enqueued: false,
    detail: result.reason,
  };
}

/* ------------------------------------------------------------------ */
/* Decision layer (web process — outcome route hook)                   */
/* ------------------------------------------------------------------ */

export interface AutomationAction {
  kind: "sms-scheduled" | "retry-scheduled" | "note";
  automationKind?: AutomationSmsKind;
  runAt?: string;
  enqueued?: boolean;
  detail: string;
}

export interface OutcomeAutomationSummary {
  /** Kill-switch state at decision time; false = nothing was scheduled. */
  enabled: boolean;
  actions: AutomationAction[];
}

/**
 * Evaluate the C4 rules for one persisted outcome and apply the
 * scheduling side effects. NEVER throws — the outcome is already
 * persisted and an automation failure must not fail it (same contract
 * as the C3 fraud hook); internal failures degrade to a summary with
 * the error named in an action detail.
 */
export async function runOutcomeAutomations(input: {
  task: DbCallTask;
  outcome: CallOutcome;
  callbackAt?: string;
}): Promise<OutcomeAutomationSummary> {
  try {
    await ensureDbFeatureFlags();
  } catch {
    // Flag source unavailable: the reader fails closed (OFF), which
    // the check below honours — automations simply do not run.
  }
  if (!isCallCenterAutomationEnabled()) {
    return { enabled: false, actions: [] };
  }
  const { task, outcome } = input;
  const actions: AutomationAction[] = [];
  try {
    const now = new Date();
    const noAnswerMinutes = await intSetting("call_center.auto_sms_no_answer_minutes", 15, 0, 1440);
    const reminderMinutes = await intSetting("call_center.callback_reminder_minutes", 10, 0, 1440);
    const startHour = await intSetting("call_center.calling_start_hour", 9, 0, 23);
    const endHour = await intSetting("call_center.calling_end_hour", 21, 1, 24);
    const isRescueTask = task.source === "FAILED_DELIVERY";

    if (outcome === "CONFIRMED") {
      // Dedupe (see header): the order flow owns the confirmation
      // SMS. The timeline note makes the absence explainable.
      await writeAutomationLog(
        randomUUID(),
        task.id,
        "AUTO_SMS_SKIPPED",
        "covered-by-order-sms: no call-center SMS on CONFIRMED — the order-confirmation SMS is owned by the order flow, and sending both would duplicate it.",
      );
      actions.push({ kind: "note", detail: "covered-by-order-sms" });
      return { enabled: true, actions };
    }

    if (outcome === "NO_ANSWER" && task.status === "QUEUED") {
      // Retry backoff (only while the task actually re-queued — the
      // final attempt closes it DONE and leaves nothing to schedule).
      const retryAt = computeRetryAt(now, task.attempts, { startHour, endHour });
      await prisma.callTask.update({
        where: { id: task.id },
        data: { nextAttemptAt: retryAt },
      });
      actions.push({
        kind: "retry-scheduled",
        runAt: retryAt.toISOString(),
        detail: `attempt ${task.attempts} backoff (calling hours ${startHour}:00–${endHour}:00 Asia/Dhaka)`,
      });
    }

    if (outcome === "NO_ANSWER") {
      if (isRescueTask) {
        // A failed-delivery rescue task gets the rescue SMS now —
        // it REPLACES the generic no-answer SMS (never both).
        actions.push(await scheduleSms(task, "RESCUE_SMS", now));
      } else {
        actions.push(
          await scheduleSms(task, "NO_ANSWER_SMS", new Date(now.getTime() + noAnswerMinutes * 60_000)),
        );
      }
    } else if (outcome === "CALLBACK" && input.callbackAt) {
      if (isRescueTask) {
        actions.push(await scheduleSms(task, "RESCUE_SMS", now));
      }
      const callbackAt = new Date(input.callbackAt);
      const reminderAt = new Date(callbackAt.getTime() - reminderMinutes * 60_000);
      actions.push(
        await scheduleSms(
          task,
          "CALLBACK_REMINDER_SMS",
          reminderAt.getTime() <= now.getTime() ? now : reminderAt,
        ),
      );
    }
    return { enabled: true, actions };
  } catch (error) {
    actions.push({
      kind: "note",
      detail: `automation-error: ${error instanceof Error ? error.name : "unknown-error"}`,
    });
    return { enabled: true, actions };
  }
}

/**
 * Send-time flag truth comes from the FeatureFlag TABLE, not the
 * unified reader: the reader hydrates its cache once per process
 * (feature-flags-db.ts ensureHydrated), so a worker process would
 * never see a kill-switch flip an admin made in the web process.
 * The C4 acceptance — "a kill-switch flag stops all automations
 * instantly" — requires the fire-time read to hit the DB. (The
 * decision path, in the web process, uses the reader: the admin API
 * updates that cache synchronously in-process.)
 */
async function flagEnabledInDb(key: string): Promise<boolean> {
  try {
    const row = await prisma.featureFlag.findUnique({
      where: { key },
      select: { enabled: true },
    });
    return row?.enabled === true;
  } catch {
    return false; // fail closed — an unreadable flag never sends
  }
}

/* ------------------------------------------------------------------ */
/* Send path (worker process — HandlerDeps.callCenterSmsSend)          */
/* ------------------------------------------------------------------ */

export interface CallCenterSmsSendDeps {
  /** The platform's SMS adapter resolver (worker-deps passes its own). */
  smsProvider: (providerName: string | null) => Promise<SmsProvider>;
}

async function skipAtSend(
  taskId: string,
  kind: AutomationSmsKind,
  decisionLogId: string,
  reason: string,
): Promise<HandlerResult> {
  await writeAutomationLog(
    randomUUID(),
    taskId,
    "AUTO_SMS_SKIPPED",
    `${kind} skipped at send time: ${reason}. decision:${decisionLogId}`,
  );
  return { status: "skipped", ref: `calltask-${taskId}`, detail: reason };
}

/**
 * Fire one scheduled automation SMS. Re-validates the world at send
 * time (see header), resolves the recipient from the DB, sends via
 * the injected adapter, and records the honest result on the task
 * timeline. Idempotent per decision: a decision that already produced
 * a terminal (SENT/SKIPPED) row returns "duplicate" and sends nothing.
 * A provider-reported failure THROWS so BullMQ retries per the sms
 * queue policy (no timeline row is written for a retryable failure —
 * the SCHEDULED row remains the visible state).
 */
export async function processCallCenterSmsJob(
  job: SmsJob,
  deps: CallCenterSmsSendDeps,
): Promise<HandlerResult> {
  const taskId = job.taskId;
  const decisionLogId = job.decisionLogId;
  const kind = job.automationKind as AutomationSmsKind | undefined;
  if (
    taskId === undefined ||
    decisionLogId === undefined ||
    kind === undefined ||
    !(AUTOMATION_SMS_KINDS as readonly string[]).includes(kind)
  ) {
    return {
      status: "skipped",
      ref: taskId ?? "",
      detail: "malformed call-center automation payload",
    };
  }
  const ref = `calltask-${taskId}`;

  // DB-backed dedupe first: the decision's terminal row is the
  // strongest evidence, and it survives worker restarts (the handler
  // layer's in-memory idempotency store does not).
  const terminal = await prisma.callLogEntry.findFirst({
    where: {
      taskId,
      outcome: { in: ["AUTO_SMS_SENT", "AUTO_SMS_SKIPPED"] },
      note: { contains: `decision:${decisionLogId}` },
    },
    select: { outcome: true },
  });
  if (terminal) {
    return { status: "duplicate", ref, detail: `decision already resolved (${terminal.outcome})` };
  }

  if (!(await flagEnabledInDb("module.call_center_automation"))) {
    return skipAtSend(taskId, kind, decisionLogId, "kill-switch module.call_center_automation is OFF");
  }
  if (!(await flagEnabledInDb("module.call_center"))) {
    return skipAtSend(taskId, kind, decisionLogId, "call-center module is OFF");
  }

  const task = await loadCallTask(taskId);
  if (!task) {
    // The task row is gone (deleted): no timeline can be written
    // against it (FK), so the skip lives only in the job result.
    return { status: "skipped", ref, detail: "task not found at send time" };
  }

  const decisionRow = await prisma.callLogEntry.findUnique({
    where: { id: decisionLogId },
    select: { createdAt: true },
  });
  if (!decisionRow) {
    return skipAtSend(taskId, kind, decisionLogId, "decision record missing (data anomaly)");
  }

  // A human outcome recorded AFTER this decision supersedes the
  // automation: the customer has been handled since (e.g. they called
  // back and confirmed), so a stale SMS must not go out. Attempt-
  // exhaustion (task DONE by NO_ANSWER with no later human log) does
  // NOT supersede — that SMS is the last resort by design.
  const laterHuman = await prisma.callLogEntry.findFirst({
    where: { taskId, agentId: { not: null }, createdAt: { gt: decisionRow.createdAt } },
    select: { outcome: true },
  });
  if (laterHuman) {
    return skipAtSend(taskId, kind, decisionLogId, `superseded by a later human outcome (${laterHuman.outcome})`);
  }
  if (task.status === "SKIPPED") {
    return skipAtSend(taskId, kind, decisionLogId, "task was closed (SKIPPED) before the send fired");
  }

  if (!task.phoneResolved || task.phone.includes("*")) {
    return skipAtSend(taskId, kind, decisionLogId, "phone-not-resolved: only a masked number is stored for this task");
  }

  const storeName = await storeNameSetting();
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const message = renderAutomationSms(kind, {
    customerName: task.customerName,
    orderNo: task.orderNo,
    storeName,
    callbackAt: task.callbackAt,
    trackUrl: `${baseUrl}/track`,
  });

  const provider = await deps.smsProvider(null);
  const result = await provider.send({
    toPhone: task.phone,
    message,
    templateKey: job.templateKey ?? TEMPLATE_KEYS[kind],
    orderId: task.orderId ?? null,
  });
  if (result.status === "failed") {
    throw new Error(`PROVIDER_FAILED:${provider.name}`);
  }
  const sandbox = provider.config.mode === "sandbox";
  await writeAutomationLog(
    randomUUID(),
    task.id,
    "AUTO_SMS_SENT",
    `${kind} sent via ${provider.name} (messageId ${result.messageId})` +
      (sandbox ? " — sandbox-simulated: the adapter is a sandbox, no real SMS left the system" : "") +
      `. decision:${decisionLogId}`,
  );
  return {
    status: "succeeded",
    ref: result.messageId,
    detail: sandbox ? "sandbox-simulated send via adapter" : "sent via adapter",
  };
}
