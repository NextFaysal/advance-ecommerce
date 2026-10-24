/**
 * Call-center DB store — Prisma-backed persistence (Agent-14 module swap).
 *
 * Replaces the in-memory demo store in service.ts for all call-center
 * routes and the admin page. The pure queue logic is UNCHANGED
 * (queue.ts): claim gates (G3), outcome rules, callback discipline and
 * performance rollups all run exactly as before — this store loads the
 * rows, runs the pure functions, and persists the results.
 *
 * Deliberate TS <-> schema mappings (drift, see final report):
 * - Schema `kind` <-> TS `source`. Schema stores ONLY
 *   `customerPhoneMasked` — a full phone number is NEVER persisted on a
 *   call task. For order-linked tasks the full number is resolved at
 *   read time from the linked Order (orders table) and exposed via the
 *   existing phoneFull gate only when it truly resolved
 *   (`phoneResolved`); masking a masked number is idempotent, so the
 *   always-masked phoneMasked contract holds either way.
 * - customerName / orderNo / orderTotalPoisha come from the linked
 *   Order; MANUAL tasks (no order) have no name column, so the name is
 *   not persisted (only the masked phone is).
 * - CallLogEntry has no callbackAt / durationSeconds /
 *   supervisorOverride columns. The outcome RESPONSE carries those from
 *   the pure recordOutcome result of the action just performed; log
 *   read-backs omit them (totalTalkSeconds therefore reads 0).
 * - assignedAt has no column and is not persisted.
 *
 * Linked-order wiring (previously pending DB): a CONFIRMED outcome
 * drives the linked order PENDING -> CONFIRMED and a CANCELLED outcome
 * drives it -> CANCELLED, both through src/orders/repository
 * applyOrderTransition (the state machine stays the single authority).
 * The call outcome is persisted FIRST — the call happened regardless —
 * and the order effect is reported back as `orderEffect`, never hidden.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import { maskPhone, normalizeBdPhone } from "../checkout/validation";
import { applyOrderTransition } from "../orders/repository";
import {
  checkOutcomeAccess,
  claimAssignedTask,
  claimNextTask,
  claimTask,
  priorityForSource,
  recordOutcome,
} from "./queue";
import type {
  CallLogEntry,
  CallOutcome,
  CallQueueSource,
  CallTask,
  CallTaskStatus,
  RecordOutcomeInput,
} from "./types";

/** A CallTask loaded from the DB, plus whether its full phone resolved. */
export type DbCallTask = CallTask & { phoneResolved: boolean };

type CallTaskRow = NonNullable<Awaited<ReturnType<typeof prisma.callTask.findUnique>>>;
type CallLogRow = NonNullable<Awaited<ReturnType<typeof prisma.callLogEntry.findUnique>>>;

const SOURCES: readonly CallQueueSource[] = [
  "PENDING_ORDER",
  "FAILED_DELIVERY",
  "ABANDONED_CHECKOUT",
  "MANUAL",
];

function rowToLog(row: CallLogRow): CallLogEntry {
  return {
    id: row.id,
    taskId: row.taskId,
    agentId: row.agentId ?? "",
    outcome: row.outcome as CallOutcome,
    note: row.note ?? undefined,
    calledAt: row.createdAt.toISOString(),
  };
}

interface OrderBits {
  orderNo: string;
  customerName: string;
  customerPhone: string;
  totalPoisha: number;
}

function rowToTask(
  row: CallTaskRow,
  order: OrderBits | undefined,
  lastOutcome: CallOutcome | undefined,
): DbCallTask {
  const source = (SOURCES as readonly string[]).includes(row.kind)
    ? (row.kind as CallQueueSource)
    : "MANUAL";
  return {
    id: row.id,
    source,
    orderId: row.orderId ?? undefined,
    orderNo: order?.orderNo,
    customerName: order?.customerName ?? "",
    // Full phone only when resolved from the linked order; otherwise the
    // stored masked form (masking it again in views is a no-op).
    phone: order?.customerPhone ?? row.customerPhoneMasked,
    phoneResolved: order !== undefined,
    orderTotalPoisha: order?.totalPoisha ?? 0,
    priority: row.priority,
    status: row.status as CallTaskStatus,
    assignedAgentId: row.assignedToId,
    attempts: row.attempts,
    lastOutcome,
    callbackAt: row.callbackAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Load every call task, enriched from linked orders + latest log outcome. */
export async function loadCallTasks(): Promise<DbCallTask[]> {
  const rows = await prisma.callTask.findMany({ orderBy: { createdAt: "asc" } });
  const orderIds = [...new Set(rows.map((r) => r.orderId).filter((x): x is string => !!x))];
  const orders = orderIds.length
    ? await prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, orderNo: true, customerName: true, customerPhone: true, totalPoisha: true },
      })
    : [];
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const logs = await prisma.callLogEntry.findMany({
    where: { taskId: { in: rows.map((r) => r.id) } },
    orderBy: { createdAt: "desc" },
    select: { taskId: true, outcome: true },
  });
  const lastOutcomeByTask = new Map<string, CallOutcome>();
  for (const log of logs) {
    if (!lastOutcomeByTask.has(log.taskId)) {
      lastOutcomeByTask.set(log.taskId, log.outcome as CallOutcome);
    }
  }
  return rows.map((row) =>
    rowToTask(row, row.orderId ? orderById.get(row.orderId) : undefined, lastOutcomeByTask.get(row.id)),
  );
}

export async function loadCallTask(taskId: string): Promise<DbCallTask | null> {
  const all = await loadCallTasks();
  return all.find((t) => t.id === taskId) ?? null;
}

export async function loadCallLogs(agentId?: string): Promise<CallLogEntry[]> {
  const rows = await prisma.callLogEntry.findMany({
    where: agentId ? { agentId } : undefined,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(rowToLog);
}

/** Create a MANUAL task. Only the MASKED phone is persisted — by design. */
export async function createManualTask(input: {
  customerName: string;
  phone: string;
}): Promise<DbCallTask> {
  // Normalize here as well as at the route, so no caller can persist an
  // unnormalized (and therefore differently-masked) number. If the input
  // cannot be normalized, the raw value is still only ever stored masked.
  const normalized = normalizeBdPhone(input.phone) ?? input.phone;
  const row = await prisma.callTask.create({
    data: {
      kind: "MANUAL",
      priority: priorityForSource("MANUAL"),
      status: "QUEUED",
      customerPhoneMasked: maskPhone(normalized),
      attempts: 0,
    },
  });
  // customerName has no schema column for a manual task (drift) — the
  // returned task carries it for this response only.
  return { ...rowToTask(row, undefined, undefined), customerName: input.customerName };
}

/**
 * Claim-next (G3): pick with the pure function over the unassigned pool,
 * then persist with a conditional update so two agents can never claim
 * the same task (the update only lands while the row is still
 * unassigned + QUEUED). Returns null when nothing is offerable.
 */
export async function claimNextTaskDb(agentId: string): Promise<DbCallTask | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const tasks = await loadCallTasks();
    const result = claimNextTask(tasks, agentId, new Date().toISOString());
    if (!result) return null;
    const updated = await prisma.callTask.updateMany({
      where: { id: result.task.id, assignedToId: null, status: "QUEUED" },
      data: { assignedToId: agentId, status: "IN_CALL" },
    });
    if (updated.count === 1) {
      return { ...result.task, phoneResolved: tasks.find((t) => t.id === result.task.id)?.phoneResolved ?? false };
    }
    // Lost a race — reload and try the next offerable task once.
  }
  return null;
}

/** Claim one specific task (G3 gates from the pure function). */
export async function claimTaskDb(
  taskId: string,
  agentId: string,
): Promise<
  | { ok: true; task: DbCallTask; alreadyMine: boolean }
  | { ok: false; code: "TASK_ASSIGNED_TO_OTHER" | "TASK_NOT_CLAIMABLE" | "NOT_FOUND"; error: string }
> {
  const task = await loadCallTask(taskId);
  if (!task) return { ok: false, code: "NOT_FOUND", error: "Call task not found." };
  const result = claimAssignedTask(task, agentId, new Date().toISOString());
  if (!result.ok) return result;
  if (result.task.status !== task.status || result.task.assignedAgentId !== task.assignedAgentId) {
    const updated = await prisma.callTask.updateMany({
      where: { id: taskId, status: task.status, assignedToId: task.assignedAgentId },
      data: { assignedToId: result.task.assignedAgentId, status: result.task.status },
    });
    if (updated.count === 0) {
      const fresh = await loadCallTask(taskId);
      if (fresh && fresh.assignedAgentId !== null && fresh.assignedAgentId !== agentId) {
        return { ok: false, code: "TASK_ASSIGNED_TO_OTHER", error: "Task is assigned to another agent." };
      }
      if (fresh) return { ok: true, task: fresh, alreadyMine: fresh.assignedAgentId === agentId };
      return { ok: false, code: "NOT_FOUND", error: "Call task not found." };
    }
  }
  return { ok: true, task: { ...result.task, phoneResolved: task.phoneResolved }, alreadyMine: result.alreadyMine };
}

export interface OrderEffect {
  attempted: boolean;
  applied: boolean;
  to?: "CONFIRMED" | "CANCELLED";
  error?: string;
}

export type RecordOutcomeDbResult =
  | { ok: true; task: DbCallTask; log: CallLogEntry; orderEffect: OrderEffect }
  | {
      ok: false;
      code?: "TASK_UNASSIGNED" | "TASK_ASSIGNED_TO_OTHER" | "NOT_FOUND";
      error: string;
    };

/**
 * Record an outcome with the full G3 gate + pure outcome rules, persist
 * task + log in one transaction, then drive the linked order through
 * the orders state machine for CONFIRMED / CANCELLED outcomes.
 */
export async function recordOutcomeDb(
  taskId: string,
  input: RecordOutcomeInput,
  meta: { agentId: string; isSupervisor: boolean },
): Promise<RecordOutcomeDbResult> {
  const task = await loadCallTask(taskId);
  if (!task) return { ok: false, code: "NOT_FOUND", error: "Call task not found." };

  const access = checkOutcomeAccess(task, meta.agentId, meta.isSupervisor);
  if (!access.allowed) return { ok: false, code: access.code, error: access.error };

  const now = new Date().toISOString();
  // Same promotion as the old route: the assignee's own QUEUED task moves
  // to IN_CALL first; a supervisor-override task keeps its assignee.
  const inCall: DbCallTask =
    task.status === "QUEUED" && task.assignedAgentId === meta.agentId
      ? { ...claimTask(task, meta.agentId, now), phoneResolved: task.phoneResolved }
      : task;

  const result = recordOutcome(inCall, input, {
    logId: randomUUID(),
    agentId: meta.agentId,
    calledAt: now,
    supervisorOverride: access.supervisorOverride,
  });
  if (!result.ok) return { ok: false, error: result.error };

  await prisma.$transaction(async (tx) => {
    await tx.callTask.update({
      where: { id: taskId },
      data: {
        status: result.task.status,
        attempts: result.task.attempts,
        callbackAt: result.task.callbackAt ? new Date(result.task.callbackAt) : null,
        assignedToId: result.task.assignedAgentId,
      },
    });
    await tx.callLogEntry.create({
      data: {
        id: result.log.id,
        taskId,
        agentId: result.log.agentId,
        outcome: result.log.outcome,
        note: result.log.note ?? null,
      },
    });
  });

  // Linked-order effect via the orders repository contract. The outcome
  // is already persisted — a failed/invalid order transition is reported
  // in orderEffect, never silently swallowed and never fatal here.
  let orderEffect: OrderEffect = { attempted: false, applied: false };
  const orderId = result.task.orderId;
  if (orderId && (input.outcome === "CONFIRMED" || input.outcome === "CANCELLED")) {
    const to = input.outcome;
    orderEffect = { attempted: true, applied: false, to };
    try {
      const transition = await applyOrderTransition(orderId, to, meta.agentId, `Call-center outcome: ${to}`);
      if (transition.kind === "ok") {
        orderEffect = { attempted: true, applied: true, to };
      } else if (transition.kind === "not_found") {
        orderEffect = { attempted: true, applied: false, to, error: "Linked order not found." };
      } else {
        orderEffect = { attempted: true, applied: false, to, error: transition.error };
      }
    } catch (err) {
      orderEffect = {
        attempted: true,
        applied: false,
        to,
        error: err instanceof Error ? err.message : "Order transition failed.",
      };
    }
  }

  return {
    ok: true,
    task: { ...result.task, phoneResolved: task.phoneResolved },
    log: result.log,
    orderEffect,
  };
}
