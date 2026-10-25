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

export const SOURCE_LABEL: Record<CallQueueSource, string> = {
  PENDING_ORDER: "অর্ডার কনফার্মেশন (Pending order)",
  FAILED_DELIVERY: "ডেলিভারি ব্যর্থ — রেসকিউ কল (Failed delivery)",
  ABANDONED_CHECKOUT: "ছেড়ে যাওয়া চেকআউট (Abandoned checkout)",
  MANUAL: "ম্যানুয়াল (Manual)",
};

export const OUTCOME_BUTTONS: Array<{ key: CallOutcome; label: string; className: string }> = [
  { key: "CONFIRMED", label: "✓ কনফার্ম করেছেন", className: "bg-emerald-600 text-white hover:bg-emerald-700" },
  { key: "CALLBACK", label: "🕐 পরে কল করতে হবে", className: "bg-amber-500 text-white hover:bg-amber-600" },
  { key: "NO_ANSWER", label: "📵 ফোন ধরেননি", className: "bg-slate-600 text-white hover:bg-slate-700" },
  { key: "WRONG_NUMBER", label: "🚫 ভুল নম্বর", className: "bg-slate-600 text-white hover:bg-slate-700" },
  { key: "CANCELLED", label: "✕ বাতিল করেছেন", className: "bg-rose-600 text-white hover:bg-rose-700" },
];

export function bnDateTime(iso: string): string {
  return new Date(iso).toLocaleString("bn-BD", {
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
export function whatsAppUrl(task: TaskView): string | null {
  if (!task.phoneFull) return null;
  const digits = task.phoneFull.replace(/\D/g, "");
  if (!digits) return null;
  const text =
    `আসসালামু আলাইকুম ${task.customerName}, আপনার অর্ডার` +
    `${task.orderNo ? ` (${task.orderNo})` : ""} সম্পর্কে কথা বলতে চাই।`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** C4 automation timeline labels (values are the log contract). */
export const AUTO_OUTCOME_LABEL: Record<string, string> = {
  AUTO_SMS_SCHEDULED: "🤖 SMS নির্ধারিত হয়েছে",
  AUTO_SMS_SENT: "🤖 SMS পাঠানো হয়েছে",
  AUTO_SMS_SKIPPED: "🤖 SMS পাঠানো হয়নি",
};

export const AUTO_KIND_LABEL: Record<string, string> = {
  NO_ANSWER_SMS: "যোগাযোগ-হয়নি",
  CALLBACK_REMINDER_SMS: "কলব্যাক রিমাইন্ডার",
  RESCUE_SMS: "রেসকিউ",
};

/** Bangla summary lines for the outcome response's automation block. */
export function automationSummaryLines(summary: AutomationSummary | undefined): string[] {
  if (!summary || !summary.enabled) return [];
  const lines: string[] = [];
  for (const a of summary.actions) {
    if (a.kind === "retry-scheduled" && a.runAt) {
      lines.push(`🤖 পুনঃচেষ্টা নির্ধারিত হয়েছে: ${bnDateTime(a.runAt)} — এর আগে টাস্কটি কিউতে আসবে না।`);
    } else if (a.kind === "sms-scheduled") {
      const label = a.automationKind ? (AUTO_KIND_LABEL[a.automationKind] ?? a.automationKind) : "";
      if (a.enqueued && a.runAt) {
        lines.push(`🤖 ${label} SMS নির্ধারিত হয়েছে: ${bnDateTime(a.runAt)}।`);
      } else {
        lines.push(`🤖 ${label} SMS নির্ধারণ করা যায়নি (${a.detail}) — টাইমলাইনে রেকর্ড আছে।`);
      }
    } else if (a.kind === "note" && a.detail === "covered-by-order-sms") {
      lines.push(
        "🤖 কনফার্মেশন SMS অর্ডার সিস্টেম থেকে যাবে — ডুপ্লিকেট এড়াতে কল সেন্টার থেকে আলাদা SMS পাঠানো হয়নি।",
      );
    }
  }
  return lines;
}

/** C3 dispositions for CANCELLED / WRONG_NUMBER outcomes (values are
 *  the API contract — do not translate the keys). */
export const DISPOSITIONS: Array<{ key: string; label: string }> = [
  { key: "PRICE", label: "দাম বেশি (Price)" },
  { key: "DELIVERY_CHARGE", label: "ডেলিভারি চার্জ (Delivery charge)" },
  { key: "CHANGED_MIND", label: "মন বদলেছেন (Changed mind)" },
  { key: "DUPLICATE_ORDER", label: "ডুপ্লিকেট অর্ডার (Duplicate order)" },
  { key: "FAKE_ORDER", label: "ভুয়া অর্ডার (Fake order)" },
  { key: "WRONG_NUMBER_CONFIRMED", label: "নম্বর ভুল নিশ্চিত (Wrong number confirmed)" },
  { key: "OTHER", label: "অন্যান্য (Other)" },
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
