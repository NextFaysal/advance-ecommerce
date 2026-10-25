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
    unassignedCount: number;
    script: ScriptStep[];
  };
  error?: { code: string; message: string };
}

interface ClaimResponse {
  data?: { task: TaskView | null; alreadyMine?: boolean };
  error?: { code: string; message: string };
}

interface OutcomeResponse {
  data?: {
    task: TaskView;
    orderEffect: OrderEffect;
    nextTask: TaskView | null;
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
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [current, setCurrent] = useState<TaskView | null>(null);
  const [upNext, setUpNext] = useState<TaskView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [callbackOpen, setCallbackOpen] = useState(false);
  const [callbackAt, setCallbackAt] = useState("");
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
      setUnassignedCount(body.data.unassignedCount);
      const inCall = body.data.queue.find((t) => t.status === "IN_CALL") ?? null;
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
        setUnassignedCount(body.data.unassignedCount);
      }
    } catch {
      // Side data only — a failed refresh must not mask the action result.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
        setUpNext(null);
        setNote("");
        setCallbackOpen(false);
        setCallbackAt("");
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
        setActionError(null);
        return;
      }
      const payload: { taskId: string; outcome: CallOutcome; note?: string; callbackAt?: string } = {
        taskId: current.id,
        outcome,
      };
      if (note.trim()) payload.note = note.trim();
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
        setCurrent(null);
        setUpNext(body.data.nextTask);
        setNote("");
        setCallbackOpen(false);
        setCallbackAt("");
        void refreshSideData();
        router.refresh();
      } catch {
        setActionError("নেটওয়ার্ক ত্রুটি — ফলাফল রেকর্ড হয়নি। আবার চেষ্টা করুন।");
      } finally {
        setBusy(false);
      }
    },
    [current, callbackOpen, callbackAt, note, refreshSideData, router],
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

      {/* Current task / claim area */}
      {current ? (
        <div className="mt-4 rounded-md border-2 border-indigo-200 bg-indigo-50/50 p-4">
          <h3 className="text-base font-semibold">📞 এখনকার কল</h3>
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
          </dl>

          {script.length > 0 ? (
            <details className="mt-3 rounded-md bg-white p-3" open>
              <summary className="cursor-pointer text-sm font-semibold">কথা বলার স্ক্রিপ্ট</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                {script.map((s) => (
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

          <div className="mt-4 flex flex-wrap gap-2">
            {OUTCOME_BUTTONS.map((b) => (
              <button
                key={b.key}
                type="button"
                disabled={busy}
                onClick={() => void recordOutcome(b.key)}
                className={`rounded-md px-3.5 py-2 text-sm font-medium disabled:opacity-50 ${b.className} ${
                  b.key === "CALLBACK" && callbackOpen ? "ring-2 ring-amber-300" : ""
                }`}
              >
                {b.key === "CALLBACK" && callbackOpen ? "🕐 সময় দিয়ে কলব্যাক নিশ্চিত করুন" : b.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            কনফার্ম/বাতিল হলে সংযুক্ত অর্ডারের অবস্থাও আপডেট হয়। ফোন না ধরলে টাস্ক আবার কিউতে ফিরে
            যায় (সর্বোচ্চ ৩ বার চেষ্টা)।
          </p>
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
          যেমন ফেসবুক কমেন্ট থেকে পাওয়া নম্বর। নম্বরটি শুধু মুখোশ (মাস্ক) করা অবস্থায় সংরক্ষণ হয়।
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
