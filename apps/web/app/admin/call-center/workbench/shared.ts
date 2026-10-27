/**
 * Shared types + pure helpers for the agent workbench components
 * (CD1 split of the former monolith). Everything here was moved
 * verbatim from workbench.tsx — the API contracts, label maps and
 * formatting rules are unchanged; the components under workbench/
 * and the composing shell (../workbench.tsx) import from here.
 *
 * API shapes are defined locally (staff-list/reviews pattern) so the
 * client bundle never imports the server-side call-center store.
 * They mirror CallTaskView / CallScriptStep in src/callcenter/types.
 */
import { formatBdt } from "@/checkout/pricing";
import { interpolate, intlLocale, pick, type Locale } from "@/i18n/locale";
import { CALL_CENTER_STRINGS } from "../strings";

export type CallOutcome = "CONFIRMED" | "CALLBACK" | "CANCELLED" | "NO_ANSWER" | "WRONG_NUMBER";
export type CallQueueSource = "PENDING_ORDER" | "FAILED_DELIVERY" | "ABANDONED_CHECKOUT" | "MANUAL";

export interface TaskView {
  id: string;
  source: CallQueueSource;
  orderId?: string;
  orderNo?: string;
  customerName: string;
  phoneMasked: string;
  phoneFull?: string;
  canViewFullPhone: boolean;
  orderTotalPoisha: number;
  priority: number;
  status: "QUEUED" | "IN_CALL" | "DONE" | "SKIPPED";
  assignedAgentId: string | null;
  assignedAt?: string;
  attempts: number;
  lastOutcome?: CallOutcome;
  callbackAt?: string;
  /** C4: no-answer retry backoff horizon, when the automation set one. */
  nextAttemptAt?: string;
  note?: string;
  /** R2.1: EFFECTIVE script for this task's source, attached by the
   *  claim + queue GET routes — steps are the scripts-store doc shape
   *  (no `outcomes`); `version` is the label stamped on the outcome. */
  script?: { version: string; steps: Array<{ key: string; promptBn: string; promptEn?: string }> };
}

export interface ScriptStep {
  key: string;
  promptBn: string;
  promptEn: string;
  outcomes: CallOutcome[];
}

export interface OrderEffect {
  attempted: boolean;
  applied: boolean;
  to?: "CONFIRMED" | "CANCELLED";
  error?: string;
}

export interface QueueResponse {
  data?: {
    queue: TaskView[];
    nextTask: TaskView | null;
    dueCallbacks: TaskView[];
    myCallbacks: TaskView[];
    unassignedCount: number;
    script: ScriptStep[];
  };
  error?: { code: string; message: string };
}

/* ------------------------- Customer 360 (C1) ------------------------ */

export interface ContextOrder {
  id: string;
  orderNo: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  customerPhone: string;
  address: {
    division: string;
    district: string;
    upazila: string;
    union?: string;
    addressLine: string;
  };
  items: Array<{ productName: string; sku: string; quantity: number; unitPricePoisha: number }>;
  subtotalPoisha: number;
  discountPoisha: number;
  shippingPoisha: number;
  codFeePoisha: number;
  totalPoisha: number;
  riskScore: number;
  riskBand: string;
  createdAt: string;
}

export interface ContextRecentOrder {
  id: string;
  orderNo: string;
  createdAt: string;
  totalPoisha: number;
  status: string;
}

export interface ContextPastCall {
  id: string;
  taskId: string;
  source: CallQueueSource;
  /** Human outcomes are the CallOutcome union; C4 automation rows
   *  carry AUTO_SMS_* values in the same field (rendered separately). */
  outcome: CallOutcome | string;
  note?: string;
  disposition?: string;
  agentId: string;
  agentName?: string;
  calledAt: string;
}

export interface TaskContext {
  task: TaskView;
  order: ContextOrder | null;
  recentOrders: ContextRecentOrder[];
  pastCalls: ContextPastCall[];
}

export interface ContextResponse {
  data?: TaskContext;
  error?: { code: string; message: string };
}

export interface OrderActionResponse {
  data?: { orderNo?: string; status?: string };
  error?: { code: string; message: string };
}

export interface ClaimResponse {
  data?: { task: TaskView | null; alreadyMine?: boolean };
  error?: { code: string; message: string };
}

/** C4 automation summary as returned by the outcome route. */
export interface AutomationSummary {
  enabled: boolean;
  actions: Array<{
    kind: string;
    automationKind?: string;
    runAt?: string;
    enqueued?: boolean;
    detail: string;
  }>;
}

export interface OutcomeResponse {
  data?: {
    task: TaskView;
    orderEffect: OrderEffect;
    nextTask: TaskView | null;
    automation?: AutomationSummary;
  };
  error?: { code: string; message: string };
}

export interface ManualResponse {
  data?: { task: TaskView };
  error?: { code: string; message: string };
}

/* ------------------------------------------------------------------ */
/* Labels + formatting                                                 */
/* ------------------------------------------------------------------ */

const S = CALL_CENTER_STRINGS;

export const SOURCE_LABEL: Record<CallQueueSource, Record<Locale, string>> = {
  PENDING_ORDER: { bn: S.bn.srcPendingOrder, en: S.en.srcPendingOrder },
  FAILED_DELIVERY: { bn: S.bn.srcFailedDelivery, en: S.en.srcFailedDelivery },
  ABANDONED_CHECKOUT: { bn: S.bn.srcAbandonedCheckout, en: S.en.srcAbandonedCheckout },
  MANUAL: { bn: S.bn.srcManual, en: S.en.srcManual },
};

export function outcomeButtons(locale: Locale): Array<{ key: CallOutcome; label: string; className: string }> {
  const s = pick(locale, S);
  return [
    { key: "CONFIRMED", label: s.outConfirmed, className: "bg-emerald-600 text-white hover:bg-emerald-700" },
    { key: "CALLBACK", label: s.outCallback, className: "bg-amber-500 text-white hover:bg-amber-600" },
    { key: "NO_ANSWER", label: s.outNoAnswer, className: "bg-slate-600 text-white hover:bg-slate-700" },
    { key: "WRONG_NUMBER", label: s.outWrongNumber, className: "bg-slate-600 text-white hover:bg-slate-700" },
    { key: "CANCELLED", label: s.outCancelled, className: "bg-rose-600 text-white hover:bg-rose-700" },
  ];
}

export function bnDateTime(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(intlLocale(locale), {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtElapsed(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** R2.2: whole seconds already elapsed on a claimed task, derived
 *  from the API view's `assignedAt` (the claim time). A fresh claim
 *  has assignedAt ≈ now, so it starts at ~0 naturally; a task resumed
 *  after a reload keeps the time already spent. 0 when assignedAt is
 *  absent/unparseable, and never negative (clock skew guard). */
export function initialElapsedSec(assignedAt: string | undefined, nowMs: number): number {
  if (!assignedAt) return 0;
  const claimedMs = Date.parse(assignedAt);
  if (Number.isNaN(claimedMs)) return 0;
  return Math.max(0, Math.floor((nowMs - claimedMs) / 1000));
}

/** C4: WhatsApp deep link (wa.me) with a prefilled Bangla template.
 *  Built ONLY from a visible full number — when the API withheld
 *  phoneFull there is nothing to link to and this returns null. */
export function whatsAppUrl(task: TaskView, locale: Locale): string | null {
  if (!task.phoneFull) return null;
  const digits = task.phoneFull.replace(/\D/g, "");
  if (!digits) return null;
  const text = interpolate(pick(locale, S).waTemplate, {
    name: task.customerName,
    order: task.orderNo ? ` (${task.orderNo})` : "",
  });
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** C4 automation timeline labels (values are the log contract). */
export const AUTO_OUTCOME_LABEL: Record<string, Record<Locale, string>> = {
  AUTO_SMS_SCHEDULED: { bn: S.bn.autoSmsScheduled, en: S.en.autoSmsScheduled },
  AUTO_SMS_SENT: { bn: S.bn.autoSmsSent, en: S.en.autoSmsSent },
  AUTO_SMS_SKIPPED: { bn: S.bn.autoSmsSkipped, en: S.en.autoSmsSkipped },
};

export const AUTO_KIND_LABEL: Record<string, Record<Locale, string>> = {
  NO_ANSWER_SMS: { bn: S.bn.autoKindNoAnswer, en: S.en.autoKindNoAnswer },
  CALLBACK_REMINDER_SMS: { bn: S.bn.autoKindCallbackReminder, en: S.en.autoKindCallbackReminder },
  RESCUE_SMS: { bn: S.bn.autoKindRescue, en: S.en.autoKindRescue },
};

/** Summary lines for the outcome response's automation block. */
export function automationSummaryLines(summary: AutomationSummary | undefined, locale: Locale): string[] {
  const s = pick(locale, S);
  if (!summary || !summary.enabled) return [];
  const lines: string[] = [];
  for (const a of summary.actions) {
    if (a.kind === "retry-scheduled" && a.runAt) {
      lines.push(interpolate(s.autoRetryLine, { date: bnDateTime(a.runAt, locale) }));
    } else if (a.kind === "sms-scheduled") {
      const label = a.automationKind ? (AUTO_KIND_LABEL[a.automationKind]?.[locale] ?? a.automationKind) : "";
      if (a.enqueued && a.runAt) {
        lines.push(interpolate(s.autoSmsScheduledLine, { label, date: bnDateTime(a.runAt, locale) }));
      } else {
        lines.push(interpolate(s.autoSmsFailedLine, { label, detail: a.detail }));
      }
    } else if (a.kind === "note" && a.detail === "covered-by-order-sms") {
      lines.push(s.autoCoveredNote);
    }
  }
  return lines;
}

/** C3 dispositions for CANCELLED / WRONG_NUMBER outcomes (values are
 *  the API contract — do not translate the keys). */
export const DISPOSITIONS: Array<{ key: string; label: Record<Locale, string> }> = [
  { key: "PRICE", label: { bn: S.bn.dispPrice, en: S.en.dispPrice } },
  { key: "DELIVERY_CHARGE", label: { bn: S.bn.dispDeliveryCharge, en: S.en.dispDeliveryCharge } },
  { key: "CHANGED_MIND", label: { bn: S.bn.dispChangedMind, en: S.en.dispChangedMind } },
  { key: "DUPLICATE_ORDER", label: { bn: S.bn.dispDuplicateOrder, en: S.en.dispDuplicateOrder } },
  { key: "FAKE_ORDER", label: { bn: S.bn.dispFakeOrder, en: S.en.dispFakeOrder } },
  { key: "WRONG_NUMBER_CONFIRMED", label: { bn: S.bn.dispWrongNumberConfirmed, en: S.en.dispWrongNumberConfirmed } },
  { key: "OTHER", label: { bn: S.bn.dispOther, en: S.en.dispOther } },
];

/** Fill the script placeholders we truthfully have ({name}, {total});
 *  {store} / {items} / {address} stay literal — the API view does not
 *  carry them, and inventing them would be worse than showing the
 *  template marker. */
export function fillScript(text: string, task: TaskView): string {
  return text
    .replaceAll("{name}", task.customerName)
    .replaceAll("{total}", task.orderTotalPoisha > 0 ? formatBdt(task.orderTotalPoisha) : "{total}");
}

export async function readJson<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}
