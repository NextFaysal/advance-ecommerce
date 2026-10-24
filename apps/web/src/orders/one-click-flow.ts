// One-Click Flow — Confirm -> Print label -> Book courier -> Send SMS.
// Each step has its own status so a partial failure is visible and retryable.
// Failure policy: the failing step is queued (BullMQ, to be wired by the jobs
// owner) with auto-retry; earlier completed steps are NOT rolled back, and the
// operator can retry just the failed step. No step blocks the HTTP request:
// booking/SMS go through the queue.
import type { Order } from "./types";

export type FlowStepId = "confirm" | "print_label" | "book_courier" | "send_sms";

export type FlowStepStatus = "pending" | "running" | "done" | "failed" | "queued";

export type OneClickFlowState = {
  orderId: string;
  steps: Record<FlowStepId, FlowStepStatus>;
  lastError?: string;
  startedAt: string;
  updatedAt: string;
};

export const ONE_CLICK_STEPS: { id: FlowStepId; label: string }[] = [
  { id: "confirm", label: "Confirm order" },
  { id: "print_label", label: "Print label" },
  { id: "book_courier", label: "Book courier" },
  { id: "send_sms", label: "Send SMS" },
];

export function initialOneClickFlow(orderId: string): OneClickFlowState {
  const now = new Date().toISOString();
  return {
    orderId,
    steps: {
      confirm: "pending",
      print_label: "pending",
      book_courier: "pending",
      send_sms: "pending",
    },
    startedAt: now,
    updatedAt: now,
  };
}

/** Advance one step; returns a new state (immutable). */
export function setFlowStep(
  flow: OneClickFlowState,
  step: FlowStepId,
  status: FlowStepStatus,
  lastError?: string,
): OneClickFlowState {
  return {
    ...flow,
    steps: { ...flow.steps, [step]: status },
    lastError: status === "failed" ? lastError : flow.lastError,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * What the Confirm step must do (wiring checklist for the API/jobs owners):
 *  1. transitionOrder(order, "CONFIRMED") — rejected if not PENDING.
 *  2. Commit reserved stock (stock_movements ledger).
 * Print label: build label data (orders/print.ts), open print view.
 * Book courier: enqueue courier adapter booking; on API-down, status "queued".
 * Send SMS: enqueue SMS via the configured provider (admin-configurable);
 * on failure, "queued" + retry, never a silent drop.
 */
export function oneClickFlowWiringNotes(order: Order): string[] {
  return [
    `Order ${order.orderNo} is ${order.status} — Confirm only runs from PENDING.`,
    `Courier: ${order.courier ?? "not chosen yet — pick one in the detail view"}.`,
    "SMS template: order confirmed + tracking link (template owner: notifications).",
  ];
}
