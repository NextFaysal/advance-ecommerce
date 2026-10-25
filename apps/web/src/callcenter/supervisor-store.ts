/**
 * Call-center SUPERVISOR store — Prisma-backed board aggregates + task
 * management writes (C2 supervisor console).
 *
 * Companion to src/callcenter/store.ts (the agent queue store), in the
 * same style: load rows with Prisma, derive views in plain TS. Nothing
 * here changes claim/outcome rules (queue.ts stays the authority for
 * agent flows) — this file only READS the whole board for a supervisor
 * and performs the three supervisor writes: reassign, release,
 * force-close.
 *
 * Privacy: the board NEVER carries a full phone number. Views carry
 * `phoneMasked` only, derived from the stored mask (or the linked
 * order's number, masked here) — a supervisor board is an overview,
 * not a calling screen.
 *
 * Audit trail: the call-center module writes no writeAudit entries in
 * its routes (checked: route.ts / claim / outcome — none do), so each
 * supervisor write records its trace on the task itself: a CallLogEntry
 * whose agentId is the ACTING supervisor, with outcome REASSIGNED /
 * RELEASED / FORCE_CLOSED and a note naming from/to or the reason.
 * (agentPerformance() counts only the five call outcomes as buckets;
 * these entries add to a supervisor's raw log total — known, accepted
 * interaction, flagged for the C5 reporting pass.)
 *
 * SLA thresholds come from Settings (src/lib/settings.ts):
 *   call_center.sla_confirm_minutes (default 30) — a PENDING_ORDER
 *     task still unattempted (attempts = 0) this long after creation
 *     is a breach.
 *   call_center.sla_rescue_minutes (default 60) — same rule for a
 *     FAILED_DELIVERY rescue task.
 * Only OPEN tasks (QUEUED / IN_CALL) can breach — a closed task is
 * history, not a breach. "Today" for outcome counts is the Asia/Dhaka
 * calendar day, matching the sales dashboard convention.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import { maskPhone } from "../checkout/validation";
import { getSetting } from "../lib/settings";
import type { CallQueueSource, CallTaskStatus } from "./types";

export const SLA_CONFIRM_KEY = "call_center.sla_confirm_minutes";
export const SLA_RESCUE_KEY = "call_center.sla_rescue_minutes";
export const SLA_CONFIRM_DEFAULT_MINUTES = 30;
export const SLA_RESCUE_DEFAULT_MINUTES = 60;

/** Log outcomes written by supervisor actions (CallLogEntry.outcome is a free string column). */
export const SUPERVISOR_LOG_OUTCOMES = {
  REASSIGNED: "REASSIGNED",
  RELEASED: "RELEASED",
  FORCE_CLOSED: "FORCE_CLOSED",
} as const;

const SOURCES: readonly CallQueueSource[] = [
  "PENDING_ORDER",
  "FAILED_DELIVERY",
  "ABANDONED_CHECKOUT",
  "MANUAL",
];

const OPEN_STATUSES: readonly string[] = ["QUEUED", "IN_CALL"];

/* ------------------------------------------------------------------ */
/* Views (all JSON-serializable — the admin page passes them to a     */
/* client component as plain props)                                   */
/* ------------------------------------------------------------------ */

export interface SupervisorTaskView {
  id: string;
  source: CallQueueSource;
  status: CallTaskStatus;
  /** Customer display name (linked order, or the manual-task name column). */
  customerName: string;
  /** ALWAYS masked — the board never carries a full number. */
  phoneMasked: string;
  orderNo?: string;
  orderTotalPoisha: number;
  priority: number;
  attempts: number;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  callbackAt?: string;
  createdAt: string;
  ageMinutes: number;
}

export interface SupervisorCallbackView extends SupervisorTaskView {
  minutesOverdue: number;
}

export interface SupervisorBreachView extends SupervisorTaskView {
  /** Which SLA rule fired: confirmation vs failed-delivery rescue. */
  rule: "CONFIRM" | "RESCUE";
  thresholdMinutes: number;
  overdueByMinutes: number;
}

export interface SupervisorAgentLoad {
  agentId: string;
  agentName: string | null;
  /** Tasks currently IN_CALL with this agent. */
  inCall: number;
  /** QUEUED tasks assigned to this agent (incl. scheduled callbacks). */
  queuedAssigned: number;
  /** CallLogEntry rows by this agent since Dhaka midnight. */
  outcomesToday: number;
  /** Of those, how many were CONFIRMED outcomes. */
  confirmedToday: number;
}

export interface StaffAgentOption {
  id: string;
  name: string | null;
}

export interface SupervisorBoard {
  generatedAt: string;
  sla: { confirmMinutes: number; rescueMinutes: number };
  countsByStatus: Record<CallTaskStatus, number>;
  countsBySource: Record<CallQueueSource, number>;
  unassignedCount: number;
  /** Age of the oldest QUEUED task; null when the queue has none. */
  oldestQueuedAgeMinutes: number | null;
  oldestQueuedTaskId: string | null;
  /** Open tasks (QUEUED / IN_CALL), priority desc then oldest first. */
  openTasks: SupervisorTaskView[];
  dueCallbacks: SupervisorCallbackView[];
  slaBreaches: SupervisorBreachView[];
  agentLoads: SupervisorAgentLoad[];
  /** Active staff — the reassign target list. */
  agents: StaffAgentOption[];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

type CallTaskRow = NonNullable<Awaited<ReturnType<typeof prisma.callTask.findUnique>>>;

function sourceOf(kind: string): CallQueueSource {
  return (SOURCES as readonly string[]).includes(kind) ? (kind as CallQueueSource) : "MANUAL";
}

/** Asia/Dhaka calendar-day range containing `now` (Dhaka is UTC+6, no DST). */
function dhakaDayRange(now: Date): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const startUtcMs = Date.UTC(part("year"), part("month") - 1, part("day")) - 6 * 60 * 60 * 1000;
  return { start: new Date(startUtcMs), end: new Date(startUtcMs + 24 * 60 * 60 * 1000) };
}

function parsePositiveMinutes(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function getSlaThresholds(): Promise<{ confirmMinutes: number; rescueMinutes: number }> {
  const [confirmRaw, rescueRaw] = await Promise.all([getSetting(SLA_CONFIRM_KEY), getSetting(SLA_RESCUE_KEY)]);
  return {
    confirmMinutes: parsePositiveMinutes(confirmRaw, SLA_CONFIRM_DEFAULT_MINUTES),
    rescueMinutes: parsePositiveMinutes(rescueRaw, SLA_RESCUE_DEFAULT_MINUTES),
  };
}

async function staffNameMap(ids: readonly string[]): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

function agentLabel(id: string | null, names: Map<string, string | null>): string {
  if (id === null) return "unassigned";
  const name = names.get(id);
  return name ? `${name} (${id})` : id;
}

/* ------------------------------------------------------------------ */
/* Board                                                              */
/* ------------------------------------------------------------------ */

export async function loadSupervisorBoard(now: Date = new Date()): Promise<SupervisorBoard> {
  const sla = await getSlaThresholds();
  const rows = await prisma.callTask.findMany({ orderBy: { createdAt: "asc" } });

  const orderIds = [...new Set(rows.map((r) => r.orderId).filter((x): x is string => !!x))];
  const orders = orderIds.length
    ? await prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, orderNo: true, customerName: true, customerPhone: true, totalPoisha: true },
      })
    : [];
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const day = dhakaDayRange(now);
  const todayLogs = await prisma.callLogEntry.findMany({
    where: { createdAt: { gte: day.start, lt: day.end } },
    select: { agentId: true, outcome: true },
  });

  const assignedIds = rows.map((r) => r.assignedToId).filter((x): x is string => !!x);
  const logAgentIds = todayLogs.map((l) => l.agentId).filter((x): x is string => !!x);
  const names = await staffNameMap([...assignedIds, ...logAgentIds]);

  const ageMinutes = (row: CallTaskRow): number =>
    Math.max(0, Math.floor((now.getTime() - row.createdAt.getTime()) / 60_000));

  const toView = (row: CallTaskRow): SupervisorTaskView => {
    const order = row.orderId ? orderById.get(row.orderId) : undefined;
    return {
      id: row.id,
      source: sourceOf(row.kind),
      status: row.status as CallTaskStatus,
      customerName: order?.customerName ?? row.customerName ?? "",
      // Masked only: the stored mask, or the linked order's number masked
      // here. The manual-task full-phone column is deliberately NOT read.
      phoneMasked: maskPhone(order?.customerPhone ?? row.customerPhoneMasked),
      orderNo: order?.orderNo,
      orderTotalPoisha: order?.totalPoisha ?? 0,
      priority: row.priority,
      attempts: row.attempts,
      assignedAgentId: row.assignedToId,
      assignedAgentName: row.assignedToId ? (names.get(row.assignedToId) ?? null) : null,
      callbackAt: row.callbackAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      ageMinutes: ageMinutes(row),
    };
  };

  const countsByStatus: Record<CallTaskStatus, number> = { QUEUED: 0, IN_CALL: 0, DONE: 0, SKIPPED: 0 };
  const countsBySource: Record<CallQueueSource, number> = {
    PENDING_ORDER: 0,
    FAILED_DELIVERY: 0,
    ABANDONED_CHECKOUT: 0,
    MANUAL: 0,
  };
  for (const row of rows) {
    const status = row.status as CallTaskStatus;
    if (status in countsByStatus) countsByStatus[status] += 1;
    countsBySource[sourceOf(row.kind)] += 1;
  }

  const queuedRows = rows.filter((r) => r.status === "QUEUED");
  const oldestQueued = queuedRows[0] ?? null; // rows are createdAt-ascending

  const openTasks = rows
    .filter((r) => OPEN_STATUSES.includes(r.status))
    .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, 100)
    .map(toView);

  const dueCallbacks: SupervisorCallbackView[] = rows
    .filter((r) => OPEN_STATUSES.includes(r.status) && r.callbackAt !== null && r.callbackAt.getTime() < now.getTime())
    .sort((a, b) => (a.callbackAt as Date).getTime() - (b.callbackAt as Date).getTime())
    .map((row) => ({
      ...toView(row),
      minutesOverdue: Math.floor((now.getTime() - (row.callbackAt as Date).getTime()) / 60_000),
    }));

  const slaBreaches: SupervisorBreachView[] = [];
  for (const row of rows) {
    if (!OPEN_STATUSES.includes(row.status) || row.attempts !== 0) continue;
    const age = ageMinutes(row);
    if (row.kind === "PENDING_ORDER" && age > sla.confirmMinutes) {
      slaBreaches.push({ ...toView(row), rule: "CONFIRM", thresholdMinutes: sla.confirmMinutes, overdueByMinutes: age - sla.confirmMinutes });
    } else if (row.kind === "FAILED_DELIVERY" && age > sla.rescueMinutes) {
      slaBreaches.push({ ...toView(row), rule: "RESCUE", thresholdMinutes: sla.rescueMinutes, overdueByMinutes: age - sla.rescueMinutes });
    }
  }
  slaBreaches.sort((a, b) => b.overdueByMinutes - a.overdueByMinutes);

  // Per-agent load: anyone holding an open task or with outcomes today.
  const loadByAgent = new Map<string, SupervisorAgentLoad>();
  const ensureLoad = (agentId: string): SupervisorAgentLoad => {
    let load = loadByAgent.get(agentId);
    if (!load) {
      load = {
        agentId,
        agentName: names.get(agentId) ?? null,
        inCall: 0,
        queuedAssigned: 0,
        outcomesToday: 0,
        confirmedToday: 0,
      };
      loadByAgent.set(agentId, load);
    }
    return load;
  };
  for (const row of rows) {
    if (row.assignedToId === null) continue;
    if (row.status === "IN_CALL") ensureLoad(row.assignedToId).inCall += 1;
    else if (row.status === "QUEUED") ensureLoad(row.assignedToId).queuedAssigned += 1;
  }
  for (const log of todayLogs) {
    if (!log.agentId) continue;
    const load = ensureLoad(log.agentId);
    load.outcomesToday += 1;
    if (log.outcome === "CONFIRMED") load.confirmedToday += 1;
  }

  const agents = await listStaffAgents();

  return {
    generatedAt: now.toISOString(),
    sla,
    countsByStatus,
    countsBySource,
    unassignedCount: queuedRows.filter((r) => r.assignedToId === null).length,
    oldestQueuedAgeMinutes: oldestQueued ? ageMinutes(oldestQueued) : null,
    oldestQueuedTaskId: oldestQueued?.id ?? null,
    openTasks,
    dueCallbacks,
    slaBreaches,
    agentLoads: [...loadByAgent.values()].sort((a, b) => b.outcomesToday - a.outcomesToday || b.inCall - a.inCall),
    agents,
  };
}

/** Active staff users — the reassign target list (id + name only). */
export async function listStaffAgents(): Promise<StaffAgentOption[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return users.map((u) => ({ id: u.id, name: u.name }));
}

/* ------------------------------------------------------------------ */
/* Supervisor writes                                                  */
/* ------------------------------------------------------------------ */

export type SupervisorActionResult =
  | { ok: true; taskId: string; note: string }
  | { ok: false; code: "NOT_FOUND" | "INVALID_STATE" | "INVALID_AGENT" | "CONFLICT"; error: string };

async function loadRow(taskId: string): Promise<CallTaskRow | null> {
  return prisma.callTask.findUnique({ where: { id: taskId } });
}

function requireOpen(row: CallTaskRow): SupervisorActionResult | null {
  if (!OPEN_STATUSES.includes(row.status)) {
    return {
      ok: false,
      code: "INVALID_STATE",
      error: `Task is ${row.status} — only a QUEUED or IN_CALL task can be managed.`,
    };
  }
  return null;
}

/**
 * Reassign a QUEUED / IN_CALL task to another staff agent. Status is
 * preserved (an IN_CALL task stays IN_CALL under the new agent). The
 * update is conditional on the row still holding the assignee we read,
 * so a concurrent claim/release cannot be silently overwritten.
 */
export async function reassignTask(
  taskId: string,
  toAgentId: string,
  actorId: string,
): Promise<SupervisorActionResult> {
  const row = await loadRow(taskId);
  if (!row) return { ok: false, code: "NOT_FOUND", error: "Call task not found." };
  const stateError = requireOpen(row);
  if (stateError) return stateError;

  const target = await prisma.user.findUnique({
    where: { id: toAgentId },
    select: { id: true, name: true, isActive: true, deletedAt: true },
  });
  if (!target || !target.isActive || target.deletedAt) {
    return { ok: false, code: "INVALID_AGENT", error: "Target agent is not an active staff user." };
  }
  if (row.assignedToId === toAgentId) {
    return { ok: true, taskId, note: "Task is already assigned to that agent — no change." };
  }

  const names = await staffNameMap([row.assignedToId, toAgentId].filter((x): x is string => !!x));
  const note = `Reassigned from ${agentLabel(row.assignedToId, names)} to ${agentLabel(toAgentId, names)} by supervisor ${actorId}.`;
  const applied = await prisma.$transaction(async (tx) => {
    const updated = await tx.callTask.updateMany({
      where: { id: taskId, status: row.status, assignedToId: row.assignedToId },
      data: { assignedToId: toAgentId },
    });
    if (updated.count !== 1) return false;
    await tx.callLogEntry.create({
      data: { id: randomUUID(), taskId, agentId: actorId, outcome: SUPERVISOR_LOG_OUTCOMES.REASSIGNED, note },
    });
    return true;
  });
  if (!applied) return { ok: false, code: "CONFLICT", error: "Task changed while reassigning — reload and try again." };
  return { ok: true, taskId, note };
}

/** Release a task back to the unassigned QUEUED pool. */
export async function releaseTask(taskId: string, actorId: string): Promise<SupervisorActionResult> {
  const row = await loadRow(taskId);
  if (!row) return { ok: false, code: "NOT_FOUND", error: "Call task not found." };
  const stateError = requireOpen(row);
  if (stateError) return stateError;
  if (row.assignedToId === null && row.status === "QUEUED") {
    return { ok: true, taskId, note: "Task is already in the unassigned pool — no change." };
  }

  const names = await staffNameMap([row.assignedToId].filter((x): x is string => !!x));
  const note = `Released from ${agentLabel(row.assignedToId, names)} back to the unassigned pool by supervisor ${actorId}.`;
  const applied = await prisma.$transaction(async (tx) => {
    const updated = await tx.callTask.updateMany({
      where: { id: taskId, status: row.status, assignedToId: row.assignedToId },
      data: { assignedToId: null, status: "QUEUED" },
    });
    if (updated.count !== 1) return false;
    await tx.callLogEntry.create({
      data: { id: randomUUID(), taskId, agentId: actorId, outcome: SUPERVISOR_LOG_OUTCOMES.RELEASED, note },
    });
    return true;
  });
  if (!applied) return { ok: false, code: "CONFLICT", error: "Task changed while releasing — reload and try again." };
  return { ok: true, taskId, note };
}

/** Force-close a task (status SKIPPED) with a supervisor-stated reason. */
export async function forceCloseTask(
  taskId: string,
  reason: string,
  actorId: string,
): Promise<SupervisorActionResult> {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return { ok: false, code: "INVALID_STATE", error: "A reason is required to force-close a task." };
  }
  const row = await loadRow(taskId);
  if (!row) return { ok: false, code: "NOT_FOUND", error: "Call task not found." };
  const stateError = requireOpen(row);
  if (stateError) return stateError;

  const applied = await prisma.$transaction(async (tx) => {
    const updated = await tx.callTask.updateMany({
      where: { id: taskId, status: row.status, assignedToId: row.assignedToId },
      data: { status: "SKIPPED" },
    });
    if (updated.count !== 1) return false;
    await tx.callLogEntry.create({
      data: { id: randomUUID(), taskId, agentId: actorId, outcome: SUPERVISOR_LOG_OUTCOMES.FORCE_CLOSED, note: trimmed },
    });
    return true;
  });
  if (!applied) return { ok: false, code: "CONFLICT", error: "Task changed while force-closing — reload and try again." };
  return { ok: true, taskId, note: trimmed };
}
