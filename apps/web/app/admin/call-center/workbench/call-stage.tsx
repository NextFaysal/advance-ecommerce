"use client";

/**
 * Call stage (CD1) — the CENTRE zone: the agent's focus while a call
 * is in hand. Customer hero (name, phone with the EXACT existing
 * mask/reveal behaviour — phoneFull only ever renders when the API
 * sent it), timer hero, script card and the big outcome action set.
 *
 * Every control is wired to the shell's state/handlers verbatim:
 * note input, CALLBACK datetime picker (first click only opens it),
 * CANCELLED / WRONG_NUMBER two-step disposition arming, and the
 * outcome buttons themselves. In the idle state the stage shows the
 * claim prompt exactly as the monolith did.
 */
import { OutcomeBadge, SourceChip } from "@/callcenter/components";
import { formatBdt } from "@/checkout/pricing";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { CALL_CENTER_STRINGS } from "../strings";
import {
  DISPOSITIONS,
  outcomeButtons,
  SOURCE_LABEL,
  bnDateTime,
  fillScript,
  fmtElapsed,
  whatsAppUrl,
  type CallOutcome,
  type ScriptStep,
  type TaskView,
} from "./shared";

export function OutcomeControls({
  busy,
  note,
  onNoteChange,
  callbackOpen,
  callbackAt,
  onCallbackAtChange,
  armedOutcome,
  disposition,
  onDispositionChange,
  onRecordOutcome,
  size = "lg",
}: {
  busy: boolean;
  note: string;
  onNoteChange: (v: string) => void;
  callbackOpen: boolean;
  callbackAt: string;
  onCallbackAtChange: (v: string) => void;
  armedOutcome: CallOutcome | null;
  disposition: string;
  onDispositionChange: (v: string) => void;
  onRecordOutcome: (outcome: CallOutcome) => void;
  size?: "lg" | "bar";
}) {
  const { locale } = useLocale();
  const s = pick(locale, CALL_CENTER_STRINGS);
  const buttons = outcomeButtons(locale);
  if (size === "bar") {
    return (
      <div className="flex snap-x gap-2 overflow-x-auto">
        {buttons.map((b, i) => (
          <button
            key={b.key}
            type="button"
            disabled={busy}
            aria-keyshortcuts={String(i + 1)}
            onClick={() => onRecordOutcome(b.key)}
            className={`shrink-0 snap-start rounded-md px-3 py-2.5 text-sm font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${b.className} ${
              b.key === "CALLBACK" && callbackOpen ? "ring-2 ring-amber-300" : ""
            } ${armedOutcome === b.key ? "ring-2 ring-slate-400" : ""}`}
          >
            {b.key === "CALLBACK" && callbackOpen
              ? s.callbackConfirmBtn
              : armedOutcome === b.key
                ? `${b.label}${s.confirmSuffix}`
                : b.label}
            <kbd
              aria-hidden="true"
              className="ml-1.5 rounded border border-white/50 bg-black/20 px-1 font-mono text-[10px] font-semibold leading-4"
            >
              {i + 1}
            </kbd>
          </button>
        ))}
      </div>
    );
  }

  return (
    <>
      <label className="mt-4 block text-sm">
        <span className="text-text-muted">{s.noteLabel}</span>
        <input
          type="text"
          value={note}
          maxLength={500}
          onChange={(e) => onNoteChange(e.target.value)}
          className="mt-1 w-full rounded-md border border-border px-2.5 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          placeholder={s.notePlaceholder}
        />
      </label>

      {callbackOpen ? (
        <label className="mt-3 block text-sm">
          <span className="text-text-muted">{s.callbackTimeReqLabel}</span>
          <input
            type="datetime-local"
            value={callbackAt}
            onChange={(e) => onCallbackAtChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-amber-400 px-2.5 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          />
        </label>
      ) : null}

      {armedOutcome === "CANCELLED" || armedOutcome === "WRONG_NUMBER" ? (
        <label className="mt-3 block text-sm">
          <span className="text-text-muted">{s.dispositionLabel}</span>
          <select
            value={disposition}
            onChange={(e) => onDispositionChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-card px-2.5 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            <option value="">{s.dispositionPlaceholder}</option>
            {DISPOSITIONS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label[locale]}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-text-muted">
            {s.dispositionHelp}
          </span>
        </label>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {buttons.map((b, i) => (
          <button
            key={b.key}
            type="button"
            disabled={busy}
            aria-keyshortcuts={String(i + 1)}
            onClick={() => onRecordOutcome(b.key)}
            className={`rounded-lg px-4 py-3 text-base font-semibold disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${b.className} ${
              b.key === "CALLBACK" && callbackOpen ? "ring-2 ring-amber-300" : ""
            } ${armedOutcome === b.key ? "ring-2 ring-slate-400" : ""} ${
              b.key === "CONFIRMED" ? "sm:col-span-2" : ""
            }`}
          >
            {b.key === "CALLBACK" && callbackOpen
              ? s.callbackConfirmBtn
              : armedOutcome === b.key
                ? `${b.label}${s.confirmSuffix}`
                : b.label}
            <kbd
              aria-hidden="true"
              className="ml-1.5 rounded border border-white/50 bg-black/20 px-1 font-mono text-[10px] font-semibold leading-4"
            >
              {i + 1}
            </kbd>
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-text-muted">
        {s.outcomeHelp}
      </p>
      <p className="mt-1.5 text-xs text-text-muted">
        {s.outcomeKeyboardHelp}
      </p>
    </>
  );
}

export function CallStage({
  current,
  script,
  elapsedSec,
  busy,
  note,
  onNoteChange,
  callbackOpen,
  callbackAt,
  onCallbackAtChange,
  armedOutcome,
  disposition,
  onDispositionChange,
  onRecordOutcome,
}: {
  current: TaskView | null;
  script: ScriptStep[];
  elapsedSec: number;
  busy: boolean;
  note: string;
  onNoteChange: (v: string) => void;
  callbackOpen: boolean;
  callbackAt: string;
  onCallbackAtChange: (v: string) => void;
  armedOutcome: CallOutcome | null;
  disposition: string;
  onDispositionChange: (v: string) => void;
  onRecordOutcome: (outcome: CallOutcome) => void;
}) {
  const { locale } = useLocale();
  const s = pick(locale, CALL_CENTER_STRINGS);
  if (!current) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface-2 p-6 text-center">
        <p className="text-4xl" aria-hidden="true">📞</p>
        <h3 className="mt-2 text-base font-semibold">{s.noCallTitle}</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-text-muted">
          {s.noCallText}
        </p>
      </div>
    );
  }

  const wa = whatsAppUrl(current, locale);

  return (
    <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/50 p-4">
      {/* Customer hero + timer */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-indigo-900">
            {s.currentCall}
          </h3>
          <p className="mt-1 truncate text-2xl font-bold">{current.customerName}</p>
          <p className="mt-0.5 text-lg font-medium">
            {current.phoneFull ? (
              <a className="rounded-sm text-indigo-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300" href={`tel:${current.phoneFull}`}>
                {current.phoneFull}
              </a>
            ) : (
              <>
                {current.phoneMasked}
                <span className="ml-2 align-middle text-xs font-normal text-text-muted">
                  {s.noFullPhonePermission}
                </span>
              </>
            )}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <SourceChip source={current.source} lang={locale} />
            {current.lastOutcome ? <OutcomeBadge outcome={current.lastOutcome} lang={locale} /> : null}
          </div>
        </div>
        {current.status === "IN_CALL" ? (
          <div className="rounded-lg bg-slate-800 px-3.5 py-2 text-center">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-300">
              {s.callDuration}
            </p>
            <p className="font-mono text-2xl font-bold tabular-nums text-white">
              ⏱ {fmtElapsed(elapsedSec)}
            </p>
          </div>
        ) : null}
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-text-muted">{s.fieldType}</dt>
          <dd>{SOURCE_LABEL[current.source][locale]}</dd>
        </div>
        <div>
          <dt className="text-text-muted">{s.fieldOrder}</dt>
          <dd>
            {current.orderNo ?? "—"}
            {current.orderTotalPoisha > 0 ? interpolate(s.orderTotalPart, { total: formatBdt(current.orderTotalPoisha) }) : ""}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">{s.prevAttempts}</dt>
          <dd>{interpolate(s.attemptsText, { n: current.attempts })}</dd>
        </div>
        {current.lastOutcome ? (
          <div>
            <dt className="text-text-muted">{s.lastOutcome}</dt>
            <dd>{current.lastOutcome}</dd>
          </div>
        ) : null}
        {current.note ? (
          <div>
            <dt className="text-text-muted">{s.taskNote}</dt>
            <dd>{current.note}</dd>
          </div>
        ) : null}
        {current.nextAttemptAt ? (
          <div>
            <dt className="text-text-muted">{s.nextAttemptAuto}</dt>
            <dd>{bnDateTime(current.nextAttemptAt, locale)}</dd>
          </div>
        ) : null}
      </dl>

      {wa ? (
        <a
          href={wa}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block rounded-md bg-green-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          {s.whatsappSend}
        </a>
      ) : null}

      {/* Script card */}
      {(current.script?.steps ?? script).length > 0 ? (
        <details className="mt-3 rounded-lg border border-indigo-100 bg-card p-3" open>
          <summary className="cursor-pointer rounded-sm text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
            {s.scriptCardTitle}{current.script ? ` — ${current.script.version}` : ""}
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            {(current.script?.steps ?? script).map((step) => (
              <li key={step.key}>{fillScript(locale === "en" && step.promptEn ? step.promptEn : step.promptBn, current)}</li>
            ))}
          </ol>
        </details>
      ) : null}

      <OutcomeControls
        busy={busy}
        note={note}
        onNoteChange={onNoteChange}
        callbackOpen={callbackOpen}
        callbackAt={callbackAt}
        onCallbackAtChange={onCallbackAtChange}
        armedOutcome={armedOutcome}
        disposition={disposition}
        onDispositionChange={onDispositionChange}
        onRecordOutcome={onRecordOutcome}
      />
    </div>
  );
}

/**
 * Mobile sticky outcome bar (CD1) — the same outcome buttons within
 * thumb reach while the agent scrolls the stage/context on a phone.
 * Identical handler + shared shell state; it hides itself while the
 * CALLBACK picker or a disposition is armed, because confirming those
 * needs the stage's input block (one submit path, no duplicates).
 */
export function MobileOutcomeBar({
  current,
  busy,
  callbackOpen,
  armedOutcome,
  note,
  callbackAt,
  disposition,
  onNoteChange,
  onCallbackAtChange,
  onDispositionChange,
  onRecordOutcome,
}: {
  current: TaskView | null;
  busy: boolean;
  callbackOpen: boolean;
  armedOutcome: CallOutcome | null;
  note: string;
  callbackAt: string;
  disposition: string;
  onNoteChange: (v: string) => void;
  onCallbackAtChange: (v: string) => void;
  onDispositionChange: (v: string) => void;
  onRecordOutcome: (outcome: CallOutcome) => void;
}) {
  if (!current || callbackOpen || armedOutcome) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-2px_10px_rgba(0,0,0,0.08)] backdrop-blur xl:hidden">
      <OutcomeControls
        size="bar"
        busy={busy}
        note={note}
        onNoteChange={onNoteChange}
        callbackOpen={callbackOpen}
        callbackAt={callbackAt}
        onCallbackAtChange={onCallbackAtChange}
        armedOutcome={armedOutcome}
        disposition={disposition}
        onDispositionChange={onDispositionChange}
        onRecordOutcome={onRecordOutcome}
      />
    </div>
  );
}
