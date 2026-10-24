/**
 * Call-center domain types — Agent 14 (Step 46, A10).
 *
 * The call queue is ORDER-FIRST: most calls confirm or rescue a real order
 * (PENDING confirmation, FAILED delivery, abandoned checkout) — plus MANUAL
 * entries a staff member adds (e.g. a phone number from a Facebook comment).
 * Phone numbers on queue items are normalized +880… server-side; outward
 * shapes always carry the MASKED number, and the full number appears only
 * in the separate optional `phoneFull` field when the caller holds
 * customers.view_full_phone (see queue.ts toQueueItemView).
 */
import { z } from "zod";

export type CallOutcome =
  | "CONFIRMED" // customer confirmed the order on the call
  | "CALLBACK" // customer asked to be called back — a callback MUST be scheduled
  | "CANCELLED" // customer cancelled on the call
  | "NO_ANSWER" // rang out / switched off
  | "WRONG_NUMBER"; // number does not belong to the customer

export const CALL_OUTCOMES: readonly CallOutcome[] = [
  "CONFIRMED",
  "CALLBACK",
  "CANCELLED",
  "NO_ANSWER",
  "WRONG_NUMBER",
];

export type CallQueueSource =
  | "PENDING_ORDER" // order placed, awaiting phone confirmation
  | "FAILED_DELIVERY" // delivery failed, rescue call
  | "ABANDONED_CHECKOUT" // abandoned checkout follow-up
  | "MANUAL"; // staff-added number

export type CallTaskStatus = "QUEUED" | "IN_CALL" | "DONE" | "SKIPPED";

export interface CallTask {
  id: string;
  source: CallQueueSource;
  /** Present for order-based tasks, absent for MANUAL. */
  orderId?: string;
  orderNo?: string;
  /** Customer display name as captured at order/manual entry time. */
  customerName: string;
  /** Normalized +8801XXXXXXXXX. Server-side only — views mask it. */
  phone: string;
  /** Total of the linked order, poisha; 0 for MANUAL tasks with no order yet. */
  orderTotalPoisha: number;
  /** Higher calls first. See priorityForSource in queue.ts. */
  priority: number;
  status: CallTaskStatus;
  /** Staff user id the task is assigned to; null = unassigned pool. */
  assignedAgentId: string | null;
  /** ISO time of the current assignment (set by claimTask / claimNextTask). */
  assignedAt?: string;
  attempts: number;
  lastOutcome?: CallOutcome;
  /** ISO time the callback is due; set only while a CALLBACK is pending. */
  callbackAt?: string;
  createdAt: string;
}

/**
 * What the agent sees. `phoneMasked` is ALWAYS masked — safe to render
 * anywhere. The full number travels only in `phoneFull`, present solely
 * when the caller holds customers.view_full_phone (canViewFullPhone).
 */
export interface CallTaskView {
  id: string;
  source: CallQueueSource;
  orderId?: string;
  orderNo?: string;
  customerName: string;
  /** Always masked (e.g. +8801******78) — never holds the full number. */
  phoneMasked: string;
  /** Full normalized number. Present ONLY when canViewFullPhone is true. */
  phoneFull?: string;
  canViewFullPhone: boolean;
  orderTotalPoisha: number;
  priority: number;
  status: CallTaskStatus;
  /** Staff user id the task is assigned to; null = unassigned pool. */
  assignedAgentId: string | null;
  /** ISO time of the current assignment, when assigned. */
  assignedAt?: string;
  attempts: number;
  lastOutcome?: CallOutcome;
  callbackAt?: string;
}

export interface CallLogEntry {
  id: string;
  taskId: string;
  agentId: string;
  outcome: CallOutcome;
  /**
   * True when the outcome was recorded by a supervisor (staff.manage) on a
   * task assigned to a DIFFERENT agent — the G3 override path. Absent/false
   * for normal assignee-recorded outcomes.
   */
  supervisorOverride?: boolean;
  note?: string;
  /** Set iff outcome is CALLBACK. Enforced in queue.ts recordOutcome. */
  callbackAt?: string;
  calledAt: string;
  durationSeconds?: number;
}

export const recordOutcomeSchema = z.object({
  outcome: z.enum(["CONFIRMED", "CALLBACK", "CANCELLED", "NO_ANSWER", "WRONG_NUMBER"]),
  note: z.string().max(500).optional(),
  /** Required when outcome = CALLBACK; queue.ts enforces this (schema cannot). */
  callbackAt: z.string().datetime().optional(),
  durationSeconds: z.number().int().nonnegative().max(7200).optional(),
});

export type RecordOutcomeInput = z.infer<typeof recordOutcomeSchema>;

export const manualTaskSchema = z.object({
  customerName: z.string().min(2),
  phone: z.string().min(11).max(15),
  note: z.string().max(500).optional(),
});

export type ManualTaskInput = z.infer<typeof manualTaskSchema>;

/** Per-agent rollup for a shift/day. Rates are basis points to stay integer. */
export interface AgentPerformance {
  agentId: string;
  totalCalls: number;
  confirmed: number;
  callbacks: number;
  cancelled: number;
  noAnswer: number;
  wrongNumber: number;
  /** confirmed / totalCalls in bps; 0 when no calls. */
  confirmRateBps: number;
  /** Sum of talk time; average is derived, never stored as a float. */
  totalTalkSeconds: number;
}

/** The spoken script outline an agent follows. bn first, en gloss for training. */
export interface CallScriptStep {
  key: string;
  promptBn: string;
  promptEn: string;
  /** Which outcome buttons to emphasise after this step. */
  outcomes: CallOutcome[];
}

export const CONFIRMATION_SCRIPT: readonly CallScriptStep[] = [
  {
    key: "greeting",
    promptBn: "আসসালামু আলাইকুম, আমি {store} থেকে বলছি। আপনি কি {name} বলছেন?",
    promptEn: "Greeting + identity check. If WRONG_NUMBER, end politely and log it.",
    outcomes: ["WRONG_NUMBER"],
  },
  {
    key: "order-recap",
    promptBn: "আপনি {items} অর্ডার করেছেন, মোট {total} টাকা (ডেলিভারি চার্জসহ)। অর্ডারটা কি কনফার্ম করব?",
    promptEn: "Recap items + grand total INCLUDING shipping/COD fee, in poisha converted for speech only.",
    outcomes: ["CONFIRMED", "CANCELLED"],
  },
  {
    key: "address-check",
    promptBn: "ডেলিভারির ঠিকানা কি এটাই — {address}? কোনো ভুল থাকলে এখনই ঠিক করে দিচ্ছি।",
    promptEn: "Read the parsed address back. Fix it in the order before confirming.",
    outcomes: ["CONFIRMED"],
  },
  {
    key: "callback-offer",
    promptBn: "আপনি এখন ব্যস্ত থাকলে আমি কখন আবার কল করব বলুন, সেই সময়েই কল করব।",
    promptEn: "If unsure, schedule a CALLBACK at a concrete time — never leave it open-ended.",
    outcomes: ["CALLBACK"],
  },
  {
    key: "closing",
    promptBn: "ধন্যবাদ! অর্ডার কনফার্ম হয়েছে, আপনি একটা SMS পাবেন। ভালো থাকবেন।",
    promptEn: "Close by outcome: confirmed -> SMS note; cancelled -> polite thank-you, no pressure.",
    outcomes: ["CONFIRMED", "CANCELLED"],
  },
];
