/**
 * Call-center demo data — FIXTURE ONLY. Agent 14.
 *
 * PERSISTENCE SWAP DONE: the production path is src/callcenter/store.ts
 * (Prisma tables CallTask / CallLogEntry); all routes and the admin page
 * read/write through it. The demo arrays below remain as labelled
 * fixtures and are no longer read by any route/page.
 */
import { claimNextTask, priorityForSource } from "./queue";
import type { CallLogEntry, CallTask } from "./types";

export const DEMO_CALL_TASKS: CallTask[] = [
  {
    id: "call-1",
    source: "PENDING_ORDER",
    orderId: "ord-1",
    orderNo: "ORD-100245",
    customerName: "Karim Uddin",
    phone: "+8801712345678",
    orderTotalPoisha: 186_000,
    priority: priorityForSource("PENDING_ORDER"),
    status: "QUEUED",
    assignedAgentId: null,
    attempts: 0,
    createdAt: "2026-10-24T06:00:00.000Z",
  },
  {
    id: "call-2",
    source: "FAILED_DELIVERY",
    orderId: "ord-2",
    orderNo: "ORD-100231",
    customerName: "Sharmin Akter",
    phone: "+8801812349876",
    orderTotalPoisha: 92_500,
    priority: priorityForSource("FAILED_DELIVERY"),
    status: "QUEUED",
    assignedAgentId: null,
    attempts: 1,
    lastOutcome: "NO_ANSWER",
    createdAt: "2026-10-24T05:30:00.000Z",
  },
];

export const demoCallLogs: CallLogEntry[] = [];
export const demoCallTasks: CallTask[] = [...DEMO_CALL_TASKS];

/**
 * Claim the next unassigned task for an agent directly in the demo store
 * (G3). The pick (claimNextTask) and the in-place replace happen in one
 * synchronous block with no awaits in between, so two requests can never
 * claim the same task — this is the demo store's atomic claim. Returns the
 * claimed task, or null when the unassigned pool has nothing offerable.
 */
export function claimNextTaskInStore(agentId: string, nowIso: string): CallTask | null {
  const result = claimNextTask(demoCallTasks, agentId, nowIso);
  if (!result) return null;
  const idx = demoCallTasks.findIndex((t) => t.id === result.task.id);
  if (idx === -1) return null;
  demoCallTasks[idx] = result.task;
  return result.task;
}
