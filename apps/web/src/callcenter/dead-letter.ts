/**
 * Call-center automation DEAD-LETTER timeline rows — doc 18, batch F1
 * (leftover from plan docs 14/15).
 *
 * When a call-center automation SMS job (sms queue, jobKind
 * "callcenter-automation") exhausts its BullMQ retries, the failure
 * lands in the worker's DeadLetterSink — a sink no staff member reads
 * per task. On the task itself there was only silence: the
 * AUTO_SMS_SCHEDULED row sits there forever and "the automation gave
 * up" is indistinguishable from "still waiting". This module writes
 * the missing terminal row onto the affected entity's timeline:
 *
 *   - the CallTask (payload taskId, the normal case) gets a
 *     CallLogEntry with outcome AUTO_SMS_DEAD_LETTER, agentId null —
 *     the same shape as the C4 automation rows in automation.ts, and
 *     the AUTO_ prefix keeps it out of the human-outcome report
 *     metrics (reports.ts excludes by prefix);
 *   - if the task row is gone (deleted) or the payload carries no
 *     taskId, an OrderNote on the payload's orderId is the fallback;
 *   - if neither entity exists, nothing is written and the result
 *     says so — the DeadLetterEntry remains the system of record.
 *
 * IDEMPOTENCY: the note text ends with the marker
 * `deadletter:<bullmq job id>` (the same trailing-marker convention
 * as automation.ts's `decision:<id>`). Before writing, the target
 * timeline is searched for that marker; a re-processed failure event
 * (worker restart, manual replay, a second exhausted event for the
 * same job) finds the existing row and writes nothing. The BullMQ
 * job id for these jobs IS the producer's stable idempotency key
 * (automation.ts sets jobId = idempotencyKey), so the marker is
 * stable across every replay of the same scheduled send.
 *
 * WIRING: the worker's processor (src/jobs/workers.ts createProcessor)
 * invokes this through the injected WorkerRuntimeDeps.callCenterDeadLetter
 * hook, assembled in src/jobs/worker-deps.ts — this module is only
 * ever loaded in the worker process. Without a running worker nothing
 * fires, which is the honest pre-VPS state: jobs cannot exhaust
 * retries in a process that never runs them.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import type { CallCenterDeadLetterInfo } from "../jobs/workers";

/** Timeline outcome for an exhausted automation job. A SEPARATE value
 *  from automation.ts's AUTOMATION_LOG_OUTCOMES on purpose: those are
 *  written by the automation module's own decision/send paths, while
 *  this one is written by the worker failure path. */
export const DEAD_LETTER_LOG_OUTCOME = "AUTO_SMS_DEAD_LETTER";

export interface CallCenterDeadLetterResult {
  written: boolean;
  /** Which timeline received the row; null when nothing was written. */
  target: "task" | "order" | null;
  /** Why nothing was written: "duplicate" | "entity-not-found". */
  reason?: string;
}

function deadLetterText(info: CallCenterDeadLetterInfo): string {
  const kind = info.automationKind ?? "UNKNOWN";
  return (
    `স্বয়ংক্রিয় SMS (${kind}) পাঠানো ব্যর্থ হয়েছে — মোট ${info.attempts} বার চেষ্টার পর সিস্টেম হাল ছেড়ে দিয়েছে ` +
    `(job ${info.jobId}, error ${info.errorCode})। অনুগ্রহ করে ম্যানুয়ালি ফলো-আপ করুন। / ` +
    `Automated SMS (${kind}) gave up after ${info.attempts} attempts ` +
    `(job ${info.jobId}, error ${info.errorCode}). Please follow up manually. ` +
    `deadletter:${info.jobId}`
  );
}

/**
 * Write the dead-letter timeline row for one exhausted call-center
 * automation job. Idempotent per BullMQ job id (see header). Never
 * throws for a missing entity — that outcome is reported in the
 * result; a DB failure itself propagates to the caller (the
 * processor hook treats it as best-effort and swallows it there).
 */
export async function recordCallCenterDeadLetter(
  info: CallCenterDeadLetterInfo,
): Promise<CallCenterDeadLetterResult> {
  const marker = `deadletter:${info.jobId}`;
  const text = deadLetterText(info);

  if (info.taskId !== undefined) {
    const task = await prisma.callTask.findUnique({
      where: { id: info.taskId },
      select: { id: true },
    });
    if (task) {
      const existing = await prisma.callLogEntry.findFirst({
        where: {
          taskId: task.id,
          outcome: DEAD_LETTER_LOG_OUTCOME,
          note: { contains: marker },
        },
        select: { id: true },
      });
      if (existing) return { written: false, target: "task", reason: "duplicate" };
      await prisma.callLogEntry.create({
        data: {
          id: randomUUID(),
          taskId: task.id,
          agentId: null,
          outcome: DEAD_LETTER_LOG_OUTCOME,
          note: text,
        },
      });
      return { written: true, target: "task" };
    }
  }

  if (info.orderId !== undefined) {
    const order = await prisma.order.findUnique({
      where: { id: info.orderId },
      select: { id: true },
    });
    if (order) {
      const existing = await prisma.orderNote.findFirst({
        where: { orderId: order.id, text: { contains: marker } },
        select: { id: true },
      });
      if (existing) return { written: false, target: "order", reason: "duplicate" };
      await prisma.orderNote.create({
        data: { id: randomUUID(), orderId: order.id, authorId: null, text },
      });
      return { written: true, target: "order" };
    }
  }

  return { written: false, target: null, reason: "entity-not-found" };
}
