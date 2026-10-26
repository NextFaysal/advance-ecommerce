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
 * - Schema `kind` <-> TS `source`.
 * - PHONE PRIVACY (C1): the full number is persisted on a task ONLY
 *   when the task has no linked order (MANUAL tasks, `customerPhone`
 *   column) — an agent could never dial a manual task otherwise.
 *   Order-linked tasks still store the masked form ONLY
 *   (`customerPhoneMasked`); their full number is resolved at read time
 *   from the linked Order (orders table), never copied onto the task.
 *   Either way the number leaves the server via the existing phoneFull
 *   gate only when a full number is available server-side
 *   (`phoneResolved`) AND the caller holds the full-phone permission;
 *   masking a masked number is idempotent, so the always-masked
 *   phoneMasked contract holds either way.
 * - customerName / orderNo / orderTotalPoisha come from the linked
 *   Order. MANUAL tasks persist their own `customerName` + `note`
 *   columns (C1) — before C1 both were silently dropped at create.
 * - CallLogEntry has no callbackAt / supervisorOverride columns. The
 *   outcome RESPONSE carries those from the pure recordOutcome result
 *   of the action just performed; log read-backs omit them.
 *   durationSeconds DOES have a column (C1): the workbench sends the
 *   timer's elapsed seconds with the outcome, it is persisted on the
 *   log row and read back (so agentPerformance's totalTalkSeconds is
 *   real). disposition / scriptVersion / qaScore / qaComment also have
 *   columns (C3): disposition + scriptVersion are stamped at outcome
 *   time, qaScore / qaComment are written later by a supervisor.
 * - assignedAt IS persisted (column added with the R2.2 completion):
 *   claim writes it, any transition out of IN_CALL clears it, so the
 *   workbench timer survives reloads on any browser.
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
import { riskLevel, type RiskLevel } from "../orders/customer";
import { applyOrderTransition } from "../orders/repository";
import { qtyNumber } from "../lib/quantity";
import {
  checkOutcomeAccess,
  claimAssignedTask,
  claimNextTask,
  claimTask,
  priorityForSource,
  recordOutcome,
} from "./queue";
import { CALL_OUTCOMES } from "./types";
import type {
  CallLogEntry,
  CallOutcome,
  CallQueueSource,
  CallTask,
  CallTaskStatus,
  RecordOutcomeInput,
} from "./types";

/**
 * A CallTask loaded from the DB, plus whether a FULL phone number is
 * available server-side for it — resolved from the linked Order, or the
 * manual task's own stored `customerPhone` (C1). The routes' view gate
 * serves phoneFull only when this is true AND the caller holds
 * customers.view_full_phone.
 */
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
    durationSeconds: row.durationSeconds ?? undefined,
    disposition: row.disposition ?? undefined,
    scriptVersion: row.scriptVersion ?? undefined,
    qaScore: row.qaScore ?? undefined,
    qaComment: row.qaComment ?? undefined,
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
  // Full phone: the linked order's number first; for a task with no
  // order (MANUAL) the task's own stored number (C1). Order-linked
  // tasks never have customerPhone set — the privacy design keeps
  // their number on the Order row only.
  const fullPhone = order?.customerPhone ?? row.customerPhone ?? undefined;
  return {
    id: row.id,
    source,
    orderId: row.orderId ?? undefined,
    orderNo: order?.orderNo,
    customerName: order?.customerName ?? row.customerName ?? "",
    // Full phone only when one is available server-side; otherwise the
    // stored masked form (masking it again in views is a no-op).
    phone: fullPhone ?? row.customerPhoneMasked,
    phoneResolved: fullPhone !== undefined,
    orderTotalPoisha: order?.totalPoisha ?? 0,
    priority: row.priority,
    status: row.status as CallTaskStatus,
    assignedAgentId: row.assignedToId,
    assignedAt: row.assignedAt?.toISOString(),
    attempts: row.attempts,
    lastOutcome,
    callbackAt: row.callbackAt?.toISOString(),
    nextAttemptAt: row.nextAttemptAt?.toISOString(),
    note: row.note ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * C4 claim gate: a task in no-answer retry backoff (nextAttemptAt in
 * the future, written by src/callcenter/automation.ts) is NOT
 * claimable — neither from the shared pool nor by specific claim —
 * until the backoff expires. Expiry is evaluated at read time, never
 * stored as a status.
 */
export function isInRetryBackoff(task: CallTask, nowIso: string): boolean {
  return task.nextAttemptAt !== undefined && task.nextAttemptAt > nowIso;
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
    // Only HUMAN outcomes count as a task's lastOutcome — automation
    // timeline rows (C4 AUTO_SMS_*) and supervisor actions (C2) share
    // this log table and are written after the call outcome, so an
    // unfiltered "latest log" would misreport them as the outcome.
    if (
      !lastOutcomeByTask.has(log.taskId) &&
      (CALL_OUTCOMES as readonly string[]).includes(log.outcome)
    ) {
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

/**
 * Create a MANUAL task (C1). A manual task has no linked order to
 * resolve a number from, so the normalized FULL phone + the customer
 * name + the staff note are persisted on the task itself
 * (customerPhone / customerName / note columns) — before C1 all three
 * were discarded at create and an agent could never dial the task.
 * The masked form is still stored alongside, and the full number only
 * ever leaves via the permission-gated phoneFull view.
 */
export async function createManualTask(input: {
  customerName: string;
  phone: string;
  note?: string;
}): Promise<DbCallTask> {
  // Normalize here as well as at the route, so no caller can persist an
  // unnormalized (and therefore differently-masked) number. If the
  // input cannot be normalized, the raw value is stored as given —
  // views still only ever expose it through the permission gate.
  const normalized = normalizeBdPhone(input.phone) ?? input.phone;
  const row = await prisma.callTask.create({
    data: {
      kind: "MANUAL",
      priority: priorityForSource("MANUAL"),
      status: "QUEUED",
      customerPhoneMasked: maskPhone(normalized),
      customerPhone: normalized,
      customerName: input.customerName,
      note: input.note ?? null,
      attempts: 0,
    },
  });
  return rowToTask(row, undefined, undefined);
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
    const nowIso = new Date().toISOString();
    // C4: tasks in retry backoff are not offered from the pool. The
    // pure pick maps over the list it is given, and this wrapper only
    // consumes the picked task, so filtering first is safe; the
    // phoneResolved lookup below uses the UNfiltered list.
    const claimable = tasks.filter((t) => !isInRetryBackoff(t, nowIso));
    const result = claimNextTask(claimable, agentId, nowIso);
    if (!result) return null;
    const updated = await prisma.callTask.updateMany({
      where: { id: result.task.id, assignedToId: null, status: "QUEUED" },
      data: { assignedToId: agentId, status: "IN_CALL", assignedAt: new Date() },
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
  // C4: a specific claim is refused while the task is in retry
  // backoff — the automation layer scheduled the next attempt, and
  // claiming early would defeat the backoff + calling-hours policy.
  if (isInRetryBackoff(task, new Date().toISOString())) {
    return {
      ok: false,
      code: "TASK_NOT_CLAIMABLE",
      error: `Task is in no-answer retry backoff until ${task.nextAttemptAt} — it becomes claimable when the backoff expires.`,
    };
  }
  const result = claimAssignedTask(task, agentId, new Date().toISOString());
  if (!result.ok) return result;
  if (result.task.status !== task.status || result.task.assignedAgentId !== task.assignedAgentId) {
    const updated = await prisma.callTask.updateMany({
      where: { id: taskId, status: task.status, assignedToId: task.assignedAgentId },
      data: {
        assignedToId: result.task.assignedAgentId,
        status: result.task.status,
        assignedAt: result.task.status === "IN_CALL" ? new Date() : null,
      },
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
  input: RecordOutcomeInput & {
    /** C3: disposition sub-reason for the outcome (workbench sends it
     *  for CANCELLED / WRONG_NUMBER); persisted on the log row. */
    disposition?: string;
    /** C3: script version the agent followed; persisted on the log row. */
    scriptVersion?: string;
  },
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
        // Leaving IN_CALL ends the timed call; staying clears nothing.
        assignedAt: result.task.status === "IN_CALL" ? undefined : null,
      },
    });
    await tx.callLogEntry.create({
      data: {
        id: result.log.id,
        taskId,
        agentId: result.log.agentId,
        outcome: result.log.outcome,
        note: result.log.note ?? null,
        // durationSeconds arrives via RecordOutcomeInput (the pure
        // recordOutcome already validated + carried it onto the log).
        durationSeconds: result.log.durationSeconds ?? null,
        disposition: input.disposition ?? null,
        scriptVersion: input.scriptVersion ?? null,
      },
    });
  });
  if (input.disposition !== undefined) result.log.disposition = input.disposition;
  if (input.scriptVersion !== undefined) result.log.scriptVersion = input.scriptVersion;

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

/* ------------------------------------------------------------------ */
/* Customer 360 (C1)                                                    */
/* ------------------------------------------------------------------ */

export interface CallTaskContextOrderItem {
  productName: string;
  sku: string;
  quantity: number;
  unitPricePoisha: number;
}

export interface CallTaskContextOrder {
  id: string;
  orderNo: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  /** Raw stored number — the ROUTE masks it unless the caller holds
   *  customers.view_full_phone (same gate as the task view). */
  customerPhone: string;
  address: {
    division: string;
    district: string;
    upazila: string;
    union?: string;
    addressLine: string;
  };
  items: CallTaskContextOrderItem[];
  subtotalPoisha: number;
  discountPoisha: number;
  shippingPoisha: number;
  codFeePoisha: number;
  totalPoisha: number;
  riskScore: number;
  riskBand: RiskLevel;
  createdAt: string;
}

export interface CallTaskContextRecentOrder {
  id: string;
  orderNo: string;
  createdAt: string;
  totalPoisha: number;
  status: string;
}

export interface CallTaskContextPastCall {
  id: string;
  taskId: string;
  /** Source (kind) of the task the call was recorded on. */
  source: CallQueueSource;
  outcome: CallOutcome;
  note?: string;
  disposition?: string;
  agentId: string;
  /** Staff display name when the user row still exists. */
  agentName?: string;
  calledAt: string;
}

export interface CallTaskContext {
  task: DbCallTask;
  /** Null for a MANUAL task (no linked order). */
  order: CallTaskContextOrder | null;
  /** The linked customer's last 10 orders (incl. the linked one);
   *  empty for a MANUAL task — no customer is linked to it. */
  recentOrders: CallTaskContextRecentOrder[];
  /** Past call logs for the same phone / order, newest first (max 20). */
  pastCalls: CallTaskContextPastCall[];
}

/**
 * Assemble the Customer-360 context for one task (C1). Read-only.
 * Past-call matching is EXACT, never by masked prefix: logs on tasks
 * sharing the linked order, tasks whose order carries the same full
 * phone, and manual tasks storing the same full phone.
 */
export async function loadTaskContext(taskId: string): Promise<CallTaskContext | null> {
  const row = await prisma.callTask.findUnique({ where: { id: taskId } });
  if (!row) return null;
  const task = await loadCallTask(taskId);
  if (!task) return null;

  let order: CallTaskContextOrder | null = null;
  let recentOrders: CallTaskContextRecentOrder[] = [];
  let fullPhone: string | null = row.customerPhone ?? null;

  if (row.orderId) {
    const orderRow = await prisma.order.findUnique({
      where: { id: row.orderId },
      include: { items: { orderBy: { createdAt: "asc" } } },
    });
    if (orderRow) {
      fullPhone = orderRow.customerPhone;
      order = {
        id: orderRow.id,
        orderNo: orderRow.orderNo,
        status: orderRow.status,
        paymentMethod: orderRow.paymentMethod,
        paymentStatus: orderRow.paymentStatus,
        customerPhone: orderRow.customerPhone,
        address: {
          division: orderRow.division,
          district: orderRow.district,
          upazila: orderRow.upazila,
          union: orderRow.union ?? undefined,
          addressLine: orderRow.addressLine,
        },
        items: orderRow.items.map((i) => ({
          productName: i.productName,
          sku: i.sku,
          quantity: qtyNumber(i.quantity),
          unitPricePoisha: i.unitPricePoisha,
        })),
        subtotalPoisha: orderRow.subtotalPoisha,
        discountPoisha: orderRow.discountPoisha,
        shippingPoisha: orderRow.shippingPoisha,
        codFeePoisha: orderRow.codFeePoisha,
        totalPoisha: orderRow.totalPoisha,
        riskScore: orderRow.riskScore,
        riskBand: riskLevel(orderRow.riskScore),
        createdAt: orderRow.createdAt.toISOString(),
      };
      const recent = await prisma.order.findMany({
        where: { customerId: orderRow.customerId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, orderNo: true, createdAt: true, totalPoisha: true, status: true },
      });
      recentOrders = recent.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        createdAt: o.createdAt.toISOString(),
        totalPoisha: o.totalPoisha,
        status: o.status,
      }));
    }
  }

  // Past calls: collect the exact-match task ids first. The task's own
  // earlier attempts always belong to its history.
  const matchedTaskIds = new Set<string>([taskId]);
  if (fullPhone) {
    const samePhoneOrders = await prisma.order.findMany({
      where: { customerPhone: fullPhone },
      select: { id: true },
    });
    const orderTaskRows = samePhoneOrders.length
      ? await prisma.callTask.findMany({
          where: {
            OR: [
              { orderId: { in: samePhoneOrders.map((o) => o.id) } },
              { customerPhone: fullPhone },
            ],
          },
          select: { id: true },
        })
      : await prisma.callTask.findMany({
          where: { customerPhone: fullPhone },
          select: { id: true },
        });
    for (const t of orderTaskRows) matchedTaskIds.add(t.id);
  }

  let pastCalls: CallTaskContextPastCall[] = [];
  if (matchedTaskIds.size > 0) {
    const [logRows, taskKindRows] = await Promise.all([
      prisma.callLogEntry.findMany({
        where: { taskId: { in: [...matchedTaskIds] } },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.callTask.findMany({
        where: { id: { in: [...matchedTaskIds] } },
        select: { id: true, kind: true },
      }),
    ]);
    const kindByTask = new Map(taskKindRows.map((t) => [t.id, t.kind]));
    const agentIds = [...new Set(logRows.map((l) => l.agentId).filter((x): x is string => !!x))];
    const agents = agentIds.length
      ? await prisma.user.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } })
      : [];
    const nameByAgent = new Map(agents.map((u) => [u.id, u.name ?? undefined]));
    pastCalls = logRows.map((l) => {
      const kind = kindByTask.get(l.taskId) ?? "MANUAL";
      return {
        id: l.id,
        taskId: l.taskId,
        source: (SOURCES as readonly string[]).includes(kind) ? (kind as CallQueueSource) : "MANUAL",
        outcome: l.outcome as CallOutcome,
        note: l.note ?? undefined,
        disposition: l.disposition ?? undefined,
        agentId: l.agentId ?? "",
        agentName: l.agentId ? nameByAgent.get(l.agentId) : undefined,
        calledAt: l.createdAt.toISOString(),
      };
    });
  }

  return { task, order, recentOrders, pastCalls };
}
