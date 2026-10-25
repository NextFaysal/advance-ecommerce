"use client";

/**
 * Call-center AGENT WORKBENCH (client) — the screen an agent actually
 * works the queue from. The server page above/below is the supervisor
 * view (full queue table + script); this component drives the agent
 * flow against the existing APIs, unchanged:
 *
 *   GET  /api/v1/admin/call-center          -> my queue view, offered
 *        next task, DUE CALLBACKS, unassigned count, CONFIRMATION_SCRIPT
 *   POST /api/v1/admin/call-center/claim    -> {} claims the next
 *        unassigned task; { taskId } claims a specific one (required
 *        before any outcome — the API answers 409 TASK_UNASSIGNED
 *        otherwise, and 403 when the task is another agent's)
 *   POST /api/v1/admin/call-center/outcome  -> { taskId, outcome, note?,
 *        callbackAt? } — CALLBACK requires a future callbackAt; the
 *        response carries orderEffect (whether the linked order moved)
 *        and the agent's NEXT task, which is offered here for claiming.
 *   POST /api/v1/admin/call-center          -> manual task create
 *        (manualTaskSchema: customerName + BD phone + optional note).
 *
 * C1 additions:
 *   GET queue response also carries `myCallbacks` — every pending
 *        callback assigned to me (due or not), overdue highlighted.
 *   GET  /api/v1/admin/call-center/tasks/[id]/context -> Customer 360
 *        for the claimed task (order detail, last 10 orders of the
 *        customer, past call logs for the same phone/order), rendered
 *        in the panel beside the task card. A failed context load
 *        never loses the claimed task.
 *   One-click order actions in the 360 panel reuse the EXISTING
 *        orders API: PATCH /api/v1/admin/orders/[id] { to, reason? } —
 *        Confirm order / Cancel order (reason required). The API's
 *        own guards decide; its result/error is shown verbatim.
 *   Call timer: elapsed mm:ss while a task is IN_CALL, counted from
 *        the claim's `assignedAt` (R2.2) so a page reload mid-call
 *        CONTINUES the clock instead of restarting at 00:00. The
 *        store does not persist assignedAt yet (documented drift in
 *        store.ts), so the queue GET's resumed view arrives without
 *        it — the workbench bridges that with a per-task localStorage
 *        record of the claim time (see stashClaimTime); a persisted
 *        assignedAt always wins when one exists. The
 *        elapsed whole seconds are sent as `durationSeconds` with
 *        the outcome POST and persisted on the call log
 *        (CallLogEntry column).
 *   Outcome payloads may carry `disposition` (CANCELLED /
 *        WRONG_NUMBER sub-reason) and always carry `scriptVersion` —
 *        the version of the EFFECTIVE script the task card rendered
 *        (R2.1): the claim and queue GET APIs attach the per-source
 *        script resolved from scripts-store (a saved doc's version,
 *        e.g. "v2" after an admin edit; the built-in is "v1"). The
 *        card renders `task.script.steps` when attached and falls
 *        back to the queue payload's built-in steps otherwise; the
 *        stamp falls back to "v1" only when nothing was attached.
 *
 * C4 additions:
 *   WhatsApp deep link on the task card (only when a full number is
 *        visible): wa.me with a prefilled Bangla template — opens the
 *        agent's own WhatsApp, needs no Meta account or API.
 *   The outcome response may carry `automation` — what the follow-up
 *        automation scheduled (retry backoff / SMS / dedupe note),
 *        rendered under the result notice. The Customer 360 panel
 *        also renders an automation timeline from the task's own
 *        AUTO_* call-log rows (scheduled / sent / skipped).
 *
 * Phone rendering: the API view is the ONLY source — `phoneFull` is
 * rendered when the API sent it (caller holds
 * customers.view_full_phone and the number resolved from the order);
 * otherwise the always-present `phoneMasked` is shown. Nothing is ever
 * unmasked client-side.
 *
 * Props: none — everything is fetched (the reviews-manager pattern),
 * so no server/client function-prop boundary exists.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { formatBdt } from "@/checkout/pricing";

/* ------------------------------------------------------------------ */
/* API shapes — defined locally (staff-list/reviews pattern) so this   */
/* client bundle never imports the server-side call-center store.      */
/* They mirror CallTaskView / CallScriptStep in src/callcenter/types.  */
/* ------------------------------------------------------------------ */

type CallOutcome = "CONFIRMED" | "CALLBACK" | "CANCELLED" | "NO_ANSWER" | "WRONG_NUMBER";
type CallQueueSource = "PENDING_ORDER" | "FAILED_DELIVERY" | "ABANDONED_CHECKOUT" | "MANUAL";

interface TaskView {
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

interface ScriptStep {
  key: string;
  promptBn: string;
  promptEn: string;
  outcomes: CallOutcome[];
}

interface OrderEffect {
  attempted: boolean;
  applied: boolean;
  to?: "CONFIRMED" | "CANCELLED";
  error?: string;
}

interface QueueResponse {
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

interface ContextOrder {
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

interface ContextRecentOrder {
  id: string;
  orderNo: string;
  createdAt: string;
  totalPoisha: number;
  status: string;
}

interface ContextPastCall {
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

interface TaskContext {
  task: TaskView;
  order: ContextOrder | null;
  recentOrders: ContextRecentOrder[];
  pastCalls: ContextPastCall[];
}

interface ContextResponse {
  data?: TaskContext;
  error?: { code: string; message: string };
}

interface OrderActionResponse {
  data?: { orderNo?: string; status?: string };
  error?: { code: string; message: string };
}

interface ClaimResponse {
  data?: { task: TaskView | null; alreadyMine?: boolean };
  error?: { code: string; message: string };
}

/** C4 automation summary as returned by the outcome route. */
interface AutomationSummary {
  enabled: boolean;
  actions: Array<{
    kind: string;
    automationKind?: string;
    runAt?: string;
    enqueued?: boolean;
    detail: string;
  }>;
}

interface OutcomeResponse {
  data?: {
    task: TaskView;
    orderEffect: OrderEffect;
    nextTask: TaskView | null;
    automation?: AutomationSummary;
  };
  error?: { code: string; message: string };
}

interface ManualResponse {
  data?: { task: TaskView };
  error?: { code: string; message: string };
}

/* ------------------------------------------------------------------ */
/* Labels + formatting                                                 */
/* ------------------------------------------------------------------ */

const SOURCE_LABEL: Record<CallQueueSource, string> = {
  PENDING_ORDER: "অর্ডার কনফার্মেশন (Pending order)",
  FAILED_DELIVERY: "ডেলিভারি ব্যর্থ — রেসকিউ কল (Failed delivery)",
  ABANDONED_CHECKOUT: "ছেড়ে যাওয়া চেকআউট (Abandoned checkout)",
  MANUAL: "ম্যানুয়াল (Manual)",
};

const OUTCOME_BUTTONS: Array<{ key: CallOutcome; label: string; className: string }> = [
  { key: "CONFIRMED", label: "✓ কনফার্ম করেছেন", className: "bg-emerald-600 text-white hover:bg-emerald-700" },
  { key: "CALLBACK", label: "🕐 পরে কল করতে হবে", className: "bg-amber-500 text-white hover:bg-amber-600" },
  { key: "NO_ANSWER", label: "📵 ফোন ধরেননি", className: "bg-slate-600 text-white hover:bg-slate-700" },
  { key: "WRONG_NUMBER", label: "🚫 ভুল নম্বর", className: "bg-slate-600 text-white hover:bg-slate-700" },
  { key: "CANCELLED", label: "✕ বাতিল করেছেন", className: "bg-rose-600 text-white hover:bg-rose-700" },
];

function bnDateTime(iso: string): string {
  return new Date(iso).toLocaleString("bn-BD", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtElapsed(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** R2.2: whole seconds already elapsed on a claimed task, derived
 *  from the API view's `assignedAt` (the claim time). A fresh claim
 *  has assignedAt ≈ now, so it starts at ~0 naturally; a task resumed
 *  after a reload keeps the time already spent. 0 when assignedAt is
 *  absent/unparseable, and never negative (clock skew guard). */
function initialElapsedSec(assignedAt: string | undefined, nowMs: number): number {
  if (!assignedAt) return 0;
  const claimedMs = Date.parse(assignedAt);
  if (Number.isNaN(claimedMs)) return 0;
  return Math.max(0, Math.floor((nowMs - claimedMs) / 1000));
}

/* R2.2 bridge: the claim RESPONSE carries the true assignedAt, but
 * the store does not persist it (store.ts documents the drift — no
 * column), so the queue GET's resumed IN_CALL view arrives without
 * one. Until the store persists claim time, the workbench remembers
 * the claim time per task in localStorage on claim and restores it
 * onto the resumed view — same browser, same agent, which is exactly
 * the reload scenario. A persisted assignedAt, once the store grows
 * one, always wins (the stash only fills an absent field). */
const CLAIM_STASH_KEY = "call-center-claim";

function stashClaimTime(task: TaskView): void {
  try {
    localStorage.setItem(
      CLAIM_STASH_KEY,
      JSON.stringify({ taskId: task.id, assignedAt: task.assignedAt ?? new Date().toISOString() }),
    );
  } catch {
    /* storage unavailable — the timer simply starts at 0 on reload */
  }
}

function stashedClaimTime(taskId: string): string | undefined {
  try {
    const raw = localStorage.getItem(CLAIM_STASH_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { taskId?: unknown; assignedAt?: unknown };
    return parsed.taskId === taskId && typeof parsed.assignedAt === "string"
      ? parsed.assignedAt
      : undefined;
  } catch {
    return undefined;
  }
}

function clearClaimTime(): void {
  try {
    localStorage.removeItem(CLAIM_STASH_KEY);
  } catch {
    /* ignore */
  }
}

/** C4: WhatsApp deep link (wa.me) with a prefilled Bangla template.
 *  Built ONLY from a visible full number — when the API withheld
 *  phoneFull there is nothing to link to and this returns null. */
function whatsAppUrl(task: TaskView): string | null {
  if (!task.phoneFull) return null;
  const digits = task.phoneFull.replace(/\D/g, "");
  if (!digits) return null;
  const text =
    `আসসালামু আলাইকুম ${task.customerName}, আপনার অর্ডার` +
    `${task.orderNo ? ` (${task.orderNo})` : ""} সম্পর্কে কথা বলতে চাই।`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** C4 automation timeline labels (values are the log contract). */
const AUTO_OUTCOME_LABEL: Record<string, string> = {
  AUTO_SMS_SCHEDULED: "🤖 SMS নির্ধারিত হয়েছে",
  AUTO_SMS_SENT: "🤖 SMS পাঠানো হয়েছে",
  AUTO_SMS_SKIPPED: "🤖 SMS পাঠানো হয়নি",
};

const AUTO_KIND_LABEL: Record<string, string> = {
  NO_ANSWER_SMS: "যোগাযোগ-হয়নি",
  CALLBACK_REMINDER_SMS: "কলব্যাক রিমাইন্ডার",
  RESCUE_SMS: "রেসকিউ",
};

/** Bangla summary lines for the outcome response's automation block. */
function automationSummaryLines(summary: AutomationSummary | undefined): string[] {
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
const DISPOSITIONS: Array<{ key: string; label: string }> = [
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
function fillScript(text: string, task: TaskView): string {
  return text
    .replaceAll("{name}", task.customerName)
    .replaceAll("{total}", task.orderTotalPoisha > 0 ? formatBdt(task.orderTotalPoisha) : "{total}");
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

type LoadState = "loading" | "ready" | "locked" | "error";

export function CallCenterWorkbench() {
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [script, setScript] = useState<ScriptStep[]>([]);
  const [dueCallbacks, setDueCallbacks] = useState<TaskView[]>([]);
  const [myCallbacks, setMyCallbacks] = useState<TaskView[]>([]);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [current, setCurrent] = useState<TaskView | null>(null);
  const [upNext, setUpNext] = useState<TaskView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // C4: automation summary lines from the last outcome response.
  const [autoLines, setAutoLines] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [callbackOpen, setCallbackOpen] = useState(false);
  const [callbackAt, setCallbackAt] = useState("");
  // C3 disposition: CANCELLED / WRONG_NUMBER are two-step (first click
  // arms the outcome + shows the dropdown, second click submits).
  const [armedOutcome, setArmedOutcome] = useState<CallOutcome | null>(null);
  const [disposition, setDisposition] = useState("");
  // Call timer (C1; R2.2 — seeded from assignedAt, see header note).
  const [elapsedSec, setElapsedSec] = useState(0);
  // Manual-task form
  const [mName, setMName] = useState("");
  const [mPhone, setMPhone] = useState("");
  const [mNote, setMNote] = useState("");
  const [mBusy, setMBusy] = useState(false);
  const [mError, setMError] = useState<string | null>(null);
  const [mNotice, setMNotice] = useState<string | null>(null);

  /** Full load (mount): also resumes an IN_CALL task — the GET queue
   *  only ever contains MY tasks plus the unassigned pool, and an
   *  unassigned task is never IN_CALL, so an IN_CALL row here is the
   *  one I claimed before a reload. */
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/call-center");
      const body = await readJson<QueueResponse>(res);
      if (res.status === 403 && body.error?.code === "FEATURE_LOCKED") {
        setLoadState("locked");
        return;
      }
      if (!res.ok || !body.data) {
        setLoadState("error");
        setLoadError(body.error?.message ?? `সার্ভার ত্রুটি (${res.status})`);
        return;
      }
      setScript(body.data.script);
      setDueCallbacks(body.data.dueCallbacks);
      setMyCallbacks(body.data.myCallbacks ?? []);
      setUnassignedCount(body.data.unassignedCount);
      const inCall = body.data.queue.find((t) => t.status === "IN_CALL") ?? null;
      // R2.2 bridge: restore the claim time onto the resumed view
      // when the API view carries none (see stashClaimTime).
      if (inCall && !inCall.assignedAt) {
        const stashed = stashedClaimTime(inCall.id);
        if (stashed) inCall.assignedAt = stashed;
      }
      setCurrent(inCall);
      setUpNext(inCall ? null : body.data.nextTask);
      setLoadState("ready");
    } catch {
      setLoadState("error");
      setLoadError("নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।");
    }
  }, []);

  /** Soft refresh of the side data (due callbacks / counts) after an
   *  action, without disturbing the task in hand. */
  const refreshSideData = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/call-center");
      const body = await readJson<QueueResponse>(res);
      if (res.ok && body.data) {
        setDueCallbacks(body.data.dueCallbacks);
        setMyCallbacks(body.data.myCallbacks ?? []);
        setUnassignedCount(body.data.unassignedCount);
      }
    } catch {
      // Side data only — a failed refresh must not mask the action result.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* Call timer (C1, R2.2): counts up from the claim's assignedAt —
   * NOT from card mount — so a reload mid-call resumes the clock
   * where it left off (the GET queue's resumed IN_CALL view carries
   * assignedAt). The elapsed seconds ride the outcome POST as
   * durationSeconds and land on the call log. */
  const currentId = current?.id;
  const currentAssignedAt = current?.assignedAt;
  useEffect(() => {
    if (!currentId) {
      setElapsedSec(0);
      return;
    }
    const seed = initialElapsedSec(currentAssignedAt, Date.now());
    setElapsedSec(seed);
    const startedAtMs = Date.now() - seed * 1000;
    const iv = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAtMs) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [currentId, currentAssignedAt]);

  const claim = useCallback(
    async (taskId?: string) => {
      setBusy(true);
      setActionError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/v1/admin/call-center/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(taskId ? { taskId } : {}),
        });
        const body = await readJson<ClaimResponse>(res);
        if (!res.ok || body.error) {
          setActionError(body.error?.message ?? `টাস্ক নেওয়া যায়নি (${res.status})`);
          return;
        }
        if (!body.data?.task) {
          setNotice("কিউতে এখন নেওয়ার মতো কোনো টাস্ক নেই। নতুন টাস্ক এলে আবার চেষ্টা করুন।");
          setUpNext(null);
          return;
        }
        setCurrent(body.data.task);
        stashClaimTime(body.data.task);
        setUpNext(null);
        setAutoLines([]);
        setNote("");
        setCallbackOpen(false);
        setCallbackAt("");
        setArmedOutcome(null);
        setDisposition("");
        void refreshSideData();
        router.refresh();
      } catch {
        setActionError("নেটওয়ার্ক ত্রুটি — টাস্ক নেওয়া যায়নি। আবার চেষ্টা করুন।");
      } finally {
        setBusy(false);
      }
    },
    [refreshSideData, router],
  );

  const recordOutcome = useCallback(
    async (outcome: CallOutcome) => {
      if (!current) return;
      if (outcome === "CALLBACK" && !callbackOpen) {
        // First click only opens the time picker — a callback without a
        // concrete time is rejected server-side anyway.
        setCallbackOpen(true);
        setArmedOutcome(null);
        setActionError(null);
        return;
      }
      if ((outcome === "CANCELLED" || outcome === "WRONG_NUMBER") && armedOutcome !== outcome) {
        // C3: first click arms the outcome and shows the (optional)
        // disposition dropdown — the second click submits.
        setArmedOutcome(outcome);
        setCallbackOpen(false);
        setActionError(null);
        return;
      }
      const payload: {
        taskId: string;
        outcome: CallOutcome;
        note?: string;
        callbackAt?: string;
        disposition?: string;
        scriptVersion?: string;
        durationSeconds?: number;
      } = {
        taskId: current.id,
        outcome,
        // R2.1: stamp the EFFECTIVE script's version — the one the
        // card actually rendered (saved doc version, e.g. "v2";
        // the built-in is "v1"). "v1" remains only as the fallback
        // when the claim/queue payload attached no script.
        scriptVersion: current.script?.version ?? "v1",
        // Timer value (whole seconds). The outcome schema caps this
        // at 7200 — clamp so a forgotten tab can never 400 the call.
        durationSeconds: Math.min(elapsedSec, 7200),
      };
      if (note.trim()) payload.note = note.trim();
      if ((outcome === "CANCELLED" || outcome === "WRONG_NUMBER") && disposition) {
        payload.disposition = disposition;
      }
      if (outcome === "CALLBACK") {
        if (!callbackAt) {
          setActionError("কলব্যাকের সময় বেছে দিন — সময় ছাড়া কলব্যাক রেকর্ড হয় না।");
          return;
        }
        const when = new Date(callbackAt);
        if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
          setActionError("কলব্যাকের সময় ভবিষ্যতের হতে হবে।");
          return;
        }
        payload.callbackAt = when.toISOString();
      }
      setBusy(true);
      setActionError(null);
      try {
        const res = await fetch("/api/v1/admin/call-center/outcome", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await readJson<OutcomeResponse>(res);
        if (!res.ok || body.error || !body.data) {
          setActionError(body.error?.message ?? `ফলাফল রেকর্ড হয়নি (${res.status})`);
          return;
        }
        const effect = body.data.orderEffect;
        if (effect.attempted && effect.applied) {
          setNotice(
            effect.to === "CONFIRMED"
              ? "ফলাফল রেকর্ড হয়েছে — সংযুক্ত অর্ডারটি CONFIRMED করা হয়েছে।"
              : "ফলাফল রেকর্ড হয়েছে — সংযুক্ত অর্ডারটি CANCELLED করা হয়েছে।",
          );
        } else if (effect.attempted && !effect.applied) {
          setNotice(
            `ফলাফল রেকর্ড হয়েছে, কিন্তু অর্ডার আপডেট হয়নি: ${effect.error ?? "অজানা কারণ"} — সুপারভাইজারকে জানান।`,
          );
        } else {
          setNotice("ফলাফল রেকর্ড হয়েছে।");
        }
        setAutoLines(automationSummaryLines(body.data.automation));
        clearClaimTime();
        setCurrent(null);
        setUpNext(body.data.nextTask);
        setNote("");
        setCallbackOpen(false);
        setCallbackAt("");
        setArmedOutcome(null);
        setDisposition("");
        void refreshSideData();
        router.refresh();
      } catch {
        setActionError("নেটওয়ার্ক ত্রুটি — ফলাফল রেকর্ড হয়নি। আবার চেষ্টা করুন।");
      } finally {
        setBusy(false);
      }
    },
    [current, callbackOpen, callbackAt, note, armedOutcome, disposition, elapsedSec, refreshSideData, router],
  );

  const createManual = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setMBusy(true);
      setMError(null);
      setMNotice(null);
      try {
        const payload: { customerName: string; phone: string; note?: string } = {
          customerName: mName.trim(),
          phone: mPhone.trim(),
        };
        if (mNote.trim()) payload.note = mNote.trim();
        const res = await fetch("/api/v1/admin/call-center", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await readJson<ManualResponse>(res);
        if (!res.ok || body.error || !body.data) {
          setMError(body.error?.message ?? `টাস্ক তৈরি হয়নি (${res.status})`);
          return;
        }
        setMNotice(`ম্যানুয়াল টাস্ক তৈরি হয়েছে (${body.data.task.phoneMasked}) — কিউতে যোগ হয়েছে।`);
        setMName("");
        setMPhone("");
        setMNote("");
        void refreshSideData();
        router.refresh();
      } catch {
        setMError("নেটওয়ার্ক ত্রুটি — টাস্ক তৈরি হয়নি। আবার চেষ্টা করুন।");
      } finally {
        setMBusy(false);
      }
    },
    [mName, mPhone, mNote, refreshSideData, router],
  );

  /* ------------------------------ render ------------------------------ */

  if (loadState === "loading") {
    return (
      <section aria-busy="true" className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">এজেন্ট ওয়ার্কবেঞ্চ</h2>
        <p className="mt-2 text-sm text-slate-500">কিউ লোড হচ্ছে…</p>
      </section>
    );
  }

  if (loadState === "locked") {
    return (
      <section className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
        <h2 className="text-lg font-semibold">এজেন্ট ওয়ার্কবেঞ্চ</h2>
        <p role="status" className="mt-2 text-sm">
          🔒 কল সেন্টার মডিউল বন্ধ আছে (<code>module.call_center</code> OFF) — ওয়ার্কবেঞ্চ ব্যবহার
          করতে Admin &gt; Settings &gt; Feature Flags থেকে মডিউলটি চালু করুন।
        </p>
      </section>
    );
  }

  if (loadState === "error") {
    return (
      <section className="mb-6 rounded-lg border border-rose-300 bg-rose-50 p-4">
        <h2 className="text-lg font-semibold">এজেন্ট ওয়ার্কবেঞ্চ</h2>
        <p role="alert" className="mt-2 text-sm text-rose-700">
          কিউ লোড করা যায়নি: {loadError}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 rounded-md bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-800"
        >
          আবার চেষ্টা করুন
        </button>
      </section>
    );
  }

  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold">এজেন্ট ওয়ার্কবেঞ্চ (Agent Workbench)</h2>
      <p className="mt-1 text-sm text-slate-500">
        অ্যাসাইন না করা টাস্ক বাকি: <strong>{unassignedCount}</strong>টি। টাস্ক নিয়ে কাজ শেষে ফলাফল
        রেকর্ড করুন — পরের টাস্ক এখানেই আসবে।
      </p>

      {notice ? (
        <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}
      {autoLines.length > 0 ? (
        <div className="mt-2 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900">
          {autoLines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      ) : null}
      {actionError ? (
        <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {actionError}
        </p>
      ) : null}

      {/* Due callbacks */}
      {dueCallbacks.length > 0 ? (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3">
          <h3 className="text-sm font-semibold text-amber-900">
            ⏰ কলব্যাকের সময় হয়েছে ({dueCallbacks.length}টি)
          </h3>
          <ul className="mt-2 space-y-2">
            {dueCallbacks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{t.customerName}</span>
                <span>{t.phoneFull ?? t.phoneMasked}</span>
                {t.callbackAt ? <span className="text-amber-800">সময়: {bnDateTime(t.callbackAt)}</span> : null}
                {!current ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void claim(t.id)}
                    className="rounded-md bg-amber-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                  >
                    এই কলটি নিন
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* My callbacks (C1) — all pending callbacks assigned to me */}
      {myCallbacks.length > 0 ? (
        <div className="mt-4 rounded-md border border-sky-300 bg-sky-50 p-3">
          <h3 className="text-sm font-semibold text-sky-900">
            🗓 আমার কলব্যাক ({myCallbacks.length}টি)
          </h3>
          <ul className="mt-2 space-y-2">
            {myCallbacks.map((t) => {
              const overdue = t.callbackAt ? new Date(t.callbackAt).getTime() < Date.now() : false;
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{t.customerName}</span>
                  <span>{t.phoneFull ?? t.phoneMasked}</span>
                  {t.callbackAt ? (
                    <span className={overdue ? "font-semibold text-rose-700" : "text-sky-800"}>
                      সময়: {bnDateTime(t.callbackAt)}
                    </span>
                  ) : null}
                  {overdue ? (
                    <span className="rounded bg-rose-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                      দেরি
                    </span>
                  ) : null}
                  {!current ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void claim(t.id)}
                      className="rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                    >
                      এই কলটি নিন
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* Current task / claim area */}
      {current ? (
        <div className="mt-4 grid items-start gap-4 xl:grid-cols-2">
        <div className="rounded-md border-2 border-indigo-200 bg-indigo-50/50 p-4">
          <h3 className="text-base font-semibold">
            📞 এখনকার কল
            {current.status === "IN_CALL" ? (
              <span className="ml-3 rounded bg-slate-800 px-2 py-0.5 align-middle font-mono text-sm text-white">
                ⏱ {fmtElapsed(elapsedSec)}
              </span>
            ) : null}
          </h3>
          <dl className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">গ্রাহক</dt>
              <dd className="font-medium">{current.customerName}</dd>
            </div>
            <div>
              <dt className="text-slate-500">ফোন</dt>
              <dd className="font-medium">
                {current.phoneFull ? (
                  <a className="text-indigo-700 underline" href={`tel:${current.phoneFull}`}>
                    {current.phoneFull}
                  </a>
                ) : (
                  <>
                    {current.phoneMasked}
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      (সম্পূর্ণ নম্বর দেখার অনুমতি নেই)
                    </span>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">ধরন</dt>
              <dd>{SOURCE_LABEL[current.source]}</dd>
            </div>
            <div>
              <dt className="text-slate-500">অর্ডার</dt>
              <dd>
                {current.orderNo ?? "—"}
                {current.orderTotalPoisha > 0 ? ` · মোট ${formatBdt(current.orderTotalPoisha)}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">আগের চেষ্টা</dt>
              <dd>{current.attempts} বার</dd>
            </div>
            {current.lastOutcome ? (
              <div>
                <dt className="text-slate-500">শেষ ফলাফল</dt>
                <dd>{current.lastOutcome}</dd>
              </div>
            ) : null}
            {current.note ? (
              <div>
                <dt className="text-slate-500">টাস্কের নোট</dt>
                <dd>{current.note}</dd>
              </div>
            ) : null}
            {current.nextAttemptAt ? (
              <div>
                <dt className="text-slate-500">পরবর্তী চেষ্টা (অটোমেশন)</dt>
                <dd>{bnDateTime(current.nextAttemptAt)}</dd>
              </div>
            ) : null}
          </dl>

          {whatsAppUrl(current) ? (
            <a
              href={whatsAppUrl(current) as string}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block rounded-md bg-green-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              💬 WhatsApp-এ মেসেজ পাঠান
            </a>
          ) : null}

          {(current.script?.steps ?? script).length > 0 ? (
            <details className="mt-3 rounded-md bg-white p-3" open>
              <summary className="cursor-pointer text-sm font-semibold">
                কথা বলার স্ক্রিপ্ট{current.script ? ` — ${current.script.version}` : ""}
              </summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                {(current.script?.steps ?? script).map((s) => (
                  <li key={s.key}>{fillScript(s.promptBn, current)}</li>
                ))}
              </ol>
            </details>
          ) : null}

          <label className="mt-4 block text-sm">
            <span className="text-slate-600">নোট (ঐচ্ছিক)</span>
            <input
              type="text"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5"
              placeholder="কলের সংক্ষিপ্ত নোট…"
            />
          </label>

          {callbackOpen ? (
            <label className="mt-3 block text-sm">
              <span className="text-slate-600">কলব্যাকের সময় (আবশ্যক)</span>
              <input
                type="datetime-local"
                value={callbackAt}
                onChange={(e) => setCallbackAt(e.target.value)}
                className="mt-1 w-full rounded-md border border-amber-400 px-2.5 py-1.5"
              />
            </label>
          ) : null}

          {armedOutcome === "CANCELLED" || armedOutcome === "WRONG_NUMBER" ? (
            <label className="mt-3 block text-sm">
              <span className="text-slate-600">কারণ / ডিসপজিশন (ঐচ্ছিক)</span>
              <select
                value={disposition}
                onChange={(e) => setDisposition(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5"
              >
                <option value="">— কারণ বেছে দিন (ঐচ্ছিক) —</option>
                {DISPOSITIONS.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-slate-500">
                বেছে দিলে ফলাফলের সঙ্গে কারণটি কল লগে জমা থাকবে। তারপর নিচের বোতামটি আবার চাপ
                দিয়ে ফলাফল নিশ্চিত করুন।
              </span>
            </label>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {OUTCOME_BUTTONS.map((b) => (
              <button
                key={b.key}
                type="button"
                disabled={busy}
                onClick={() => void recordOutcome(b.key)}
                className={`rounded-md px-3.5 py-2 text-sm font-medium disabled:opacity-50 ${b.className} ${
                  b.key === "CALLBACK" && callbackOpen ? "ring-2 ring-amber-300" : ""
                } ${armedOutcome === b.key ? "ring-2 ring-slate-400" : ""}`}
              >
                {b.key === "CALLBACK" && callbackOpen
                  ? "🕐 সময় দিয়ে কলব্যাক নিশ্চিত করুন"
                  : armedOutcome === b.key
                    ? `${b.label} — নিশ্চিত করুন`
                    : b.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            কনফার্ম/বাতিল হলে সংযুক্ত অর্ডারের অবস্থাও আপডেট হয়। ফোন না ধরলে টাস্ক আবার কিউতে ফিরে
            যায় (সর্বোচ্চ ৩ বার চেষ্টা)।
          </p>
        </div>
        <Customer360Panel key={current.id} taskId={current.id} onOrderMutated={() => router.refresh()} />
        </div>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => void claim()}
            className="rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            📞 পরবর্তী কল নিন (Claim next task)
          </button>
          {upNext ? (
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-medium">পরের টাস্ক প্রস্তুত:</p>
              <p className="mt-1">
                {upNext.customerName} · {upNext.phoneFull ?? upNext.phoneMasked} ·{" "}
                {SOURCE_LABEL[upNext.source]}
                {upNext.orderNo ? ` · অর্ডার ${upNext.orderNo}` : ""}
                {upNext.orderTotalPoisha > 0 ? ` · ${formatBdt(upNext.orderTotalPoisha)}` : ""}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void claim(upNext.id)}
                className="mt-2 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                এই কলটি নিন
              </button>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              এই মুহূর্তে দেওয়ার মতো টাস্ক নেই — নতুন অর্ডার/কলব্যাক এলে এখানে আসবে।
            </p>
          )}
        </div>
      )}

      {/* Manual task form */}
      <form onSubmit={createManual} className="mt-6 rounded-md border border-slate-200 p-4">
        <h3 className="text-sm font-semibold">ম্যানুয়াল টাস্ক যোগ করুন</h3>
        <p className="mt-1 text-xs text-slate-500">
          যেমন ফেসবুক কমেন্ট থেকে পাওয়া নম্বর। ম্যানুয়াল টাস্কে নাম, নোট ও নম্বরটি সংরক্ষণ করা
          হয় যাতে এজেন্ট কল করতে পারে — সম্পূর্ণ নম্বর শুধু অনুমতিপ্রাপ্ত
          (customers.view_full_phone) ব্যবহারকারীরাই দেখতে পান; বাকি সব জায়গায় মাস্ক করা থাকে।
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="text-slate-600">গ্রাহকের নাম *</span>
            <input
              type="text"
              required
              minLength={2}
              value={mName}
              onChange={(e) => setMName(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">মোবাইল নম্বর *</span>
            <input
              type="tel"
              required
              value={mPhone}
              onChange={(e) => setMPhone(e.target.value)}
              placeholder="01XXXXXXXXX"
              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">নোট (ঐচ্ছিক)</span>
            <input
              type="text"
              maxLength={500}
              value={mNote}
              onChange={(e) => setMNote(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5"
            />
          </label>
        </div>
        {mError ? (
          <p role="alert" className="mt-2 text-sm text-rose-700">
            {mError}
          </p>
        ) : null}
        {mNotice ? (
          <p role="status" className="mt-2 text-sm text-emerald-700">
            {mNotice}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={mBusy}
          className="mt-3 rounded-md bg-slate-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          টাস্ক যোগ করুন
        </button>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Customer 360 panel (C1) — self-contained: fetches its own context  */
/* for the claimed task (parent remounts it per task via `key`), so a  */
/* failed load can never lose the claimed task in the workbench.      */
/* One-click order actions reuse the EXISTING orders API              */
/* (PATCH /api/v1/admin/orders/[id]) — no parallel transition path.   */
/* ------------------------------------------------------------------ */

function Customer360Panel({
  taskId,
  onOrderMutated,
}: {
  taskId: string;
  onOrderMutated: () => void;
}) {
  const [ctx, setCtx] = useState<TaskContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [reason, setReason] = useState("");
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderMsg, setOrderMsg] = useState<string | null>(null);
  const [orderErr, setOrderErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const res = await fetch(`/api/v1/admin/call-center/tasks/${taskId}/context`);
        const body = await readJson<ContextResponse>(res);
        if (cancelled) return;
        if (!res.ok || !body.data) {
          setLoadError(body.error?.message ?? `তথ্য লোড হয়নি (${res.status})`);
          setCtx(null);
          return;
        }
        setCtx(body.data);
      } catch {
        if (!cancelled) {
          setLoadError("নেটওয়ার্ক ত্রুটি — গ্রাহকের তথ্য লোড হয়নি।");
          setCtx(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, reloadKey]);

  const orderAction = useCallback(
    async (to: "CONFIRMED" | "CANCELLED") => {
      if (!ctx?.order) return;
      if (to === "CANCELLED" && !cancelArmed) {
        // First click only arms the reason input — the orders API
        // requires a reason for CANCELLED and rejects without one.
        setCancelArmed(true);
        setOrderErr(null);
        return;
      }
      if (to === "CANCELLED" && !reason.trim()) {
        setOrderErr("বাতিলের কারণ আবশ্যক — কারণ না লিখলে অর্ডার বাতিল হবে না।");
        return;
      }
      setOrderBusy(true);
      setOrderErr(null);
      setOrderMsg(null);
      try {
        const res = await fetch(`/api/v1/admin/orders/${ctx.order.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(to === "CANCELLED" ? { to, reason: reason.trim() } : { to }),
        });
        const body = await readJson<OrderActionResponse>(res);
        if (!res.ok || body.error) {
          // The orders API's own verdict, verbatim (its guards decide —
          // a 403 for a missing permission lands here unchanged).
          setOrderErr(body.error?.message ?? `অর্ডার আপডেট হয়নি (${res.status})`);
          return;
        }
        setOrderMsg(
          to === "CONFIRMED"
            ? `অর্ডার ${body.data?.orderNo ?? ""} CONFIRMED করা হয়েছে।`
            : `অর্ডার ${body.data?.orderNo ?? ""} CANCELLED করা হয়েছে।`,
        );
        setCancelArmed(false);
        setReason("");
        setReloadKey((k) => k + 1);
        onOrderMutated();
      } catch {
        setOrderErr("নেটওয়ার্ক ত্রুটি — অর্ডার আপডেট হয়নি। আবার চেষ্টা করুন।");
      } finally {
        setOrderBusy(false);
      }
    },
    [ctx, cancelArmed, reason, onOrderMutated],
  );

  const order = ctx?.order ?? null;
  const canCancel =
    order !== null &&
    (order.status === "PENDING" ||
      order.status === "CONFIRMED" ||
      order.status === "PROCESSING" ||
      order.status === "PACKED");

  return (
    <div className="rounded-md border border-slate-300 bg-white p-4">
      <h3 className="text-base font-semibold">🧾 গ্রাহক ৩৬০ (Customer 360)</h3>

      {loading ? (
        <p className="mt-2 text-sm text-slate-500">গ্রাহকের তথ্য লোড হচ্ছে…</p>
      ) : loadError ? (
        <div className="mt-2">
          <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
            গ্রাহকের তথ্য লোড করা যায়নি: {loadError} — কলটি তবু চালিয়ে যেতে পারবেন।
          </p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-2 rounded-md bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-800"
          >
            আবার চেষ্টা করুন
          </button>
        </div>
      ) : ctx ? (
        <>
          {order ? (
            <>
              <dl className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-slate-500">অর্ডার</dt>
                  <dd className="font-medium">
                    {order.orderNo} · <span>{order.status}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">পেমেন্ট</dt>
                  <dd>
                    {order.paymentMethod} · {order.paymentStatus}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">ফোন (অর্ডারে)</dt>
                  <dd className="font-medium">{order.customerPhone}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">রিস্ক স্কোর</dt>
                  <dd>
                    {order.riskScore} ({order.riskBand})
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">ঠিকানা</dt>
                  <dd>
                    {order.address.addressLine}
                    {order.address.union ? `, ${order.address.union}` : ""}, {order.address.upazila},{" "}
                    {order.address.district}, {order.address.division}
                  </dd>
                </div>
              </dl>

              <h4 className="mt-3 text-sm font-semibold">পণ্যসমূহ</h4>
              <ul className="mt-1 space-y-1 text-sm">
                {order.items.map((i, idx) => (
                  <li key={idx} className="flex flex-wrap justify-between gap-2">
                    <span>
                      {i.productName} <span className="text-slate-500">({i.sku})</span> × {i.quantity}
                    </span>
                    <span>{formatBdt(i.unitPricePoisha * i.quantity)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-2 space-y-0.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">সাবটোটাল</dt>
                  <dd>{formatBdt(order.subtotalPoisha)}</dd>
                </div>
                {order.discountPoisha > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">ছাড়</dt>
                    <dd>−{formatBdt(order.discountPoisha)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <dt className="text-slate-500">ডেলিভারি</dt>
                  <dd>{formatBdt(order.shippingPoisha)}</dd>
                </div>
                {order.codFeePoisha > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">COD ফি</dt>
                    <dd>{formatBdt(order.codFeePoisha)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold">
                  <dt>মোট</dt>
                  <dd>{formatBdt(order.totalPoisha)}</dd>
                </div>
              </dl>

              {/* One-click order actions (existing orders API) */}
              <div className="mt-3 rounded-md bg-slate-50 p-3">
                <h4 className="text-sm font-semibold">এক ক্লিকে অর্ডার অ্যাকশন</h4>
                {orderMsg ? (
                  <p role="status" className="mt-2 rounded-md bg-emerald-50 px-2.5 py-1.5 text-sm text-emerald-800">
                    {orderMsg}
                  </p>
                ) : null}
                {orderErr ? (
                  <p role="alert" className="mt-2 rounded-md bg-rose-50 px-2.5 py-1.5 text-sm text-rose-700">
                    {orderErr}
                  </p>
                ) : null}
                {cancelArmed ? (
                  <label className="mt-2 block text-sm">
                    <span className="text-slate-600">বাতিলের কারণ (আবশ্যক)</span>
                    <input
                      type="text"
                      value={reason}
                      maxLength={500}
                      onChange={(e) => setReason(e.target.value)}
                      className="mt-1 w-full rounded-md border border-rose-300 px-2.5 py-1.5"
                      placeholder="কেন বাতিল হচ্ছে…"
                    />
                  </label>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {order.status === "PENDING" ? (
                    <button
                      type="button"
                      disabled={orderBusy}
                      onClick={() => void orderAction("CONFIRMED")}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      ✓ অর্ডার কনফার্ম করুন
                    </button>
                  ) : null}
                  {canCancel ? (
                    <button
                      type="button"
                      disabled={orderBusy}
                      onClick={() => void orderAction("CANCELLED")}
                      className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                      {cancelArmed ? "✕ কারণসহ বাতিল নিশ্চিত করুন" : "✕ অর্ডার বাতিল করুন"}
                    </button>
                  ) : null}
                  {order.status !== "PENDING" && !canCancel ? (
                    <p className="text-xs text-slate-500">
                      এই অবস্থায় ({order.status}) এখান থেকে কনফার্ম/বাতিল করা যায় না।
                    </p>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-600">
              ম্যানুয়াল টাস্ক — কোনো অর্ডার যুক্ত নেই।
              {ctx.task.note ? (
                <>
                  {" "}
                  টাস্কের নোট: <span className="font-medium">{ctx.task.note}</span>
                </>
              ) : null}
            </p>
          )}

          {ctx.recentOrders.length > 0 ? (
            <>
              <h4 className="mt-4 text-sm font-semibold">
                গ্রাহকের আগের অর্ডার (সর্বশেষ {ctx.recentOrders.length}টি)
              </h4>
              <table className="mt-1 w-full text-left text-sm">
                <thead>
                  <tr className="text-slate-500">
                    <th className="py-1 pr-2 font-medium">অর্ডার</th>
                    <th className="py-1 pr-2 font-medium">তারিখ</th>
                    <th className="py-1 pr-2 font-medium">মোট</th>
                    <th className="py-1 font-medium">অবস্থা</th>
                  </tr>
                </thead>
                <tbody>
                  {ctx.recentOrders.map((o) => (
                    <tr key={o.id} className="border-t border-slate-100">
                      <td className="py-1 pr-2">
                        {o.orderNo}
                        {order && o.id === order.id ? (
                          <span className="ml-1 text-xs text-indigo-600">(এই অর্ডার)</span>
                        ) : null}
                      </td>
                      <td className="py-1 pr-2">{bnDateTime(o.createdAt)}</td>
                      <td className="py-1 pr-2">{formatBdt(o.totalPoisha)}</td>
                      <td className="py-1">{o.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          <h4 className="mt-4 text-sm font-semibold">আগের কলসমূহ</h4>
          {ctx.pastCalls.filter((c) => !String(c.outcome).startsWith("AUTO_")).length > 0 ? (
            <ul className="mt-1 space-y-2 text-sm">
              {ctx.pastCalls
                .filter((c) => !String(c.outcome).startsWith("AUTO_"))
                .map((c) => (
                  <li key={c.id} className="rounded-md bg-slate-50 px-3 py-2">
                    <span className="font-medium">{bnDateTime(c.calledAt)}</span> ·{" "}
                    {SOURCE_LABEL[c.source]} · ফলাফল: {c.outcome}
                    {c.disposition ? ` (${c.disposition})` : ""} · এজেন্ট:{" "}
                    {c.agentName ?? c.agentId}
                    {c.note ? (
                      <span className="block text-slate-600">নোট: {c.note}</span>
                    ) : null}
                  </li>
                ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-slate-500">এই নম্বরে/অর্ডারে আগের কোনো কল নেই।</p>
          )}

          {/* C4 automation timeline — this task's AUTO_* log rows:
              what was scheduled, what was sent, what was skipped and
              why (the log note carries the detail verbatim). */}
          {ctx.pastCalls.some(
            (c) => c.taskId === taskId && String(c.outcome).startsWith("AUTO_"),
          ) ? (
            <>
              <h4 className="mt-4 text-sm font-semibold">🤖 অটোমেশন টাইমলাইন</h4>
              <ul className="mt-1 space-y-2 text-sm">
                {ctx.pastCalls
                  .filter((c) => c.taskId === taskId && String(c.outcome).startsWith("AUTO_"))
                  .map((c) => (
                    <li key={c.id} className="rounded-md bg-sky-50 px-3 py-2">
                      <span className="font-medium">{bnDateTime(c.calledAt)}</span> ·{" "}
                      {AUTO_OUTCOME_LABEL[c.outcome] ?? c.outcome}
                      {c.note ? (
                        <span className="block text-slate-600">{c.note}</span>
                      ) : null}
                    </li>
                  ))}
              </ul>
              <p className="mt-1 text-xs text-slate-500">
                অটোমেশন (module.call_center_automation) চালু থাকলে ফলাফলের পর SMS ও পুনঃচেষ্টা
                নিজে নিজে নির্ধারিত হয় — উপরে তার সম্পূর্ণ রেকর্ড। SMS স্যান্ডবক্স অ্যাডাপ্টার
                দিয়ে গেলে নোটে তা লেখা থাকে; আসল SMS শুধু লাইভ অ্যাডাপ্টার কনফিগার হলেই যায়।
              </p>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
