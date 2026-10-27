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
 * CD1: this file is now the composing SHELL — it owns every piece of
 * state and every handler/fetch exactly as before and passes
 * serialisable props + its own callbacks to the presentational
 * components under ./workbench/ (queue rail, call stage, context
 * panel, callbacks strip, manual form). Same client tree, no
 * server/client boundary added.
 *
 * CD4: keyboard outcome shortcuts (1–5 select/press, Enter confirms
 * a pending selection) live in one shell effect below — every key
 * calls the same recordOutcome as the buttons, so no validation
 * path is added, bypassed or duplicated.
 *
 * Props: none — everything is fetched (the reviews-manager pattern),
 * so no server/client function-prop boundary exists.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { CallbacksStrip } from "./workbench/callbacks-strip";
import { CallStage, MobileOutcomeBar } from "./workbench/call-stage";
import { Customer360Panel } from "./workbench/context-panel";
import { ManualTaskForm } from "./workbench/manual-form";
import { QueueRail } from "./workbench/queue-rail";
import { CALL_CENTER_STRINGS } from "./strings";
import {
  outcomeButtons,
  automationSummaryLines,
  initialElapsedSec,
  readJson,
  type CallOutcome,
  type ClaimResponse,
  type ManualResponse,
  type OutcomeResponse,
  type QueueResponse,
  type ScriptStep,
  type TaskView,
} from "./workbench/shared";

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

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

type LoadState = "loading" | "ready" | "locked" | "error";

export function CallCenterWorkbench() {
  const router = useRouter();
  const { locale } = useLocale();
  const s = pick(locale, CALL_CENTER_STRINGS);
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
  // CD1: mobile queue drawer visibility (presentation only).
  const [queueOpen, setQueueOpen] = useState(false);
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
        setLoadError(body.error?.message ?? interpolate(s.serverError, { status: res.status }));
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
      setLoadError(s.networkErrorRetry);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

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
          setActionError(body.error?.message ?? interpolate(s.claimFailed, { status: res.status }));
          return;
        }
        if (!body.data?.task) {
          setNotice(s.noTaskAvailable);
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
        setActionError(s.claimNetworkError);
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshSideData, router, locale],
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
          setActionError(s.callbackTimeRequired);
          return;
        }
        const when = new Date(callbackAt);
        if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
          setActionError(s.callbackTimeFuture);
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
          setActionError(body.error?.message ?? interpolate(s.outcomeFailed, { status: res.status }));
          return;
        }
        const effect = body.data.orderEffect;
        if (effect.attempted && effect.applied) {
          setNotice(effect.to === "CONFIRMED" ? s.outcomeOrderConfirmed : s.outcomeOrderCancelled);
        } else if (effect.attempted && !effect.applied) {
          setNotice(interpolate(s.outcomeOrderNotUpdated, { error: effect.error ?? s.unknownReason }));
        } else {
          setNotice(s.outcomeRecorded);
        }
        setAutoLines(automationSummaryLines(body.data.automation, locale));
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
        setActionError(s.outcomeNetworkError);
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, callbackOpen, callbackAt, note, armedOutcome, disposition, elapsedSec, refreshSideData, router, locale],
  );

  /* CD4: keyboard outcome shortcuts. Keys 1–5 press the outcome
   * buttons in OUTCOME_BUTTONS order; Enter confirms a pending
   * selection. Every key goes through the SAME recordOutcome the
   * buttons call, so its state machine applies untouched: CALLBACK's
   * first press only opens the time picker (Enter then submits, and
   * recordOutcome's future-time validation still runs), and
   * CANCELLED / WRONG_NUMBER's first press only arms the disposition
   * select (Enter submits). CONFIRMED / NO_ANSWER have no selection
   * step in the button flow, so their key submits exactly like their
   * button does — no new flow is invented for them.
   * Guards: nothing fires while busy, while the mobile queue drawer
   * is open, with a modifier held, on key-repeat, or while the agent
   * is typing in an input / textarea / select / contentEditable (a
   * digit inside the callback time field is data, not a shortcut).
   * Enter is additionally ignored when focus sits on a button or
   * link — the browser already turns that Enter into the very same
   * click, and handling it here too would fire recordOutcome twice.
   * The mobile outcome bar needs no guard of its own: it renders
   * buttons only (clicks); this single window listener is the only
   * keyboard path, so the bar can never double-fire. */
  useEffect(() => {
    if (!current || busy || queueOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }
      if (e.key >= "1" && e.key <= "5") {
        const btn = outcomeButtons(locale)[Number(e.key) - 1];
        if (btn) {
          e.preventDefault();
          void recordOutcome(btn.key);
        }
        return;
      }
      if (e.key === "Enter") {
        // Confirm ONLY a pending selection — the two states where
        // recordOutcome's first call deliberately did not submit.
        const pending: CallOutcome | null = callbackOpen ? "CALLBACK" : armedOutcome;
        if (!pending) return;
        if (target?.closest("button, a")) return;
        e.preventDefault();
        void recordOutcome(pending);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, busy, queueOpen, callbackOpen, armedOutcome, recordOutcome, locale]);

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
          setMError(body.error?.message ?? interpolate(s.manualFailed, { status: res.status }));
          return;
        }
        setMNotice(interpolate(s.manualCreated, { phone: body.data.task.phoneMasked }));
        setMName("");
        setMPhone("");
        setMNote("");
        void refreshSideData();
        router.refresh();
      } catch {
        setMError(s.manualNetworkError);
      } finally {
        setMBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mName, mPhone, mNote, refreshSideData, router, locale],
  );

  /* ------------------------------ render ------------------------------ */

  if (loadState === "loading") {
    return (
      <section aria-busy="true" className="mb-6 rounded-lg border border-border bg-card p-4">
        <h2 className="text-lg font-semibold">{s.wbTitle}</h2>
        <p className="mt-2 text-sm text-text-muted">{s.queueLoading}</p>
      </section>
    );
  }

  if (loadState === "locked") {
    return (
      <section className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
        <h2 className="text-lg font-semibold">{s.wbTitle}</h2>
        <p role="status" className="mt-2 text-sm">
          {s.wbLockedA}<code>module.call_center</code>{s.wbLockedB}
        </p>
      </section>
    );
  }

  if (loadState === "error") {
    return (
      <section className="mb-6 rounded-lg border border-rose-300 bg-rose-50 p-4">
        <h2 className="text-lg font-semibold">{s.wbTitle}</h2>
        <p role="alert" className="mt-2 text-sm text-rose-700">
          {interpolate(s.queueLoadFailed, { error: loadError })}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 rounded-md bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          {s.tryAgain}
        </button>
      </section>
    );
  }

  return (
    <section className={`mb-6 rounded-lg border border-border bg-card p-4 ${current ? "pb-24 xl:pb-4" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{s.wbTitle}</h2>
        <button
          type="button"
          onClick={() => setQueueOpen(true)}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 xl:hidden"
        >
          {interpolate(s.queueButton, { count: unassignedCount })}
        </button>
      </div>
      <p className="mt-1 text-sm text-text-muted">
        {s.unassignedLead} <strong>{unassignedCount}</strong>{s.unassignedTail}
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

      <div className="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-[290px_minmax(0,1fr)_400px]">
        <div className="order-2 xl:order-none xl:col-span-3">
          <CallbacksStrip
            dueCallbacks={dueCallbacks}
            myCallbacks={myCallbacks}
            current={current}
            busy={busy}
            onClaimTask={(id) => void claim(id)}
          />
        </div>

        <div className="order-4 xl:order-none">
          <QueueRail
            unassignedCount={unassignedCount}
            upNext={upNext}
            current={current}
            busy={busy}
            onClaimNext={() => void claim()}
            onClaimTask={(id) => void claim(id)}
            open={queueOpen}
            onClose={() => setQueueOpen(false)}
          >
            <ManualTaskForm
              mName={mName}
              mPhone={mPhone}
              mNote={mNote}
              mBusy={mBusy}
              mError={mError}
              mNotice={mNotice}
              onNameChange={setMName}
              onPhoneChange={setMPhone}
              onNoteChange={setMNote}
              onSubmit={createManual}
            />
          </QueueRail>
        </div>

        <div className="order-1 xl:order-none">
          <CallStage
            current={current}
            script={script}
            elapsedSec={elapsedSec}
            busy={busy}
            note={note}
            onNoteChange={setNote}
            callbackOpen={callbackOpen}
            callbackAt={callbackAt}
            onCallbackAtChange={setCallbackAt}
            armedOutcome={armedOutcome}
            disposition={disposition}
            onDispositionChange={setDisposition}
            onRecordOutcome={(o) => void recordOutcome(o)}
          />
        </div>

        {current ? (
          <div className="order-3 xl:order-none">
            <Customer360Panel
              key={current.id}
              taskId={current.id}
              onOrderMutated={() => router.refresh()}
            />
          </div>
        ) : null}
      </div>

      <MobileOutcomeBar
        current={current}
        busy={busy}
        callbackOpen={callbackOpen}
        armedOutcome={armedOutcome}
        note={note}
        callbackAt={callbackAt}
        disposition={disposition}
        onNoteChange={setNote}
        onCallbackAtChange={setCallbackAt}
        onDispositionChange={setDisposition}
        onRecordOutcome={(o) => void recordOutcome(o)}
      />
    </section>
  );
}
