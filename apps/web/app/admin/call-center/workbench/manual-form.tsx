"use client";

/**
 * Manual task form (CD1 split) — markup and behaviour verbatim from
 * the monolith; the shell owns the field state and the submit handler
 * (createManual) and passes them down.
 */
import type { FormEvent } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { CALL_CENTER_STRINGS } from "../strings";

export function ManualTaskForm({
  mName,
  mPhone,
  mNote,
  mBusy,
  mError,
  mNotice,
  onNameChange,
  onPhoneChange,
  onNoteChange,
  onSubmit,
}: {
  mName: string;
  mPhone: string;
  mNote: string;
  mBusy: boolean;
  mError: string | null;
  mNotice: string | null;
  onNameChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onNoteChange: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
}) {
  const { locale } = useLocale();
  const s = pick(locale, CALL_CENTER_STRINGS);
  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-border p-4">
      <h3 className="text-sm font-semibold">{s.manualTitle}</h3>
      <p className="mt-1 text-xs text-text-muted">
        {s.manualHelp}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3">
        <label className="block text-sm">
          <span className="text-text-muted">{s.customerNameReq}</span>
          <input
            type="text"
            required
            minLength={2}
            value={mName}
            onChange={(e) => onNameChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-border px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          />
        </label>
        <label className="block text-sm">
          <span className="text-text-muted">{s.mobileReq}</span>
          <input
            type="tel"
            required
            value={mPhone}
            onChange={(e) => onPhoneChange(e.target.value)}
            placeholder="01XXXXXXXXX"
            className="mt-1 w-full rounded-md border border-border px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          />
        </label>
        <label className="block text-sm">
          <span className="text-text-muted">{s.noteLabel}</span>
          <input
            type="text"
            maxLength={500}
            value={mNote}
            onChange={(e) => onNoteChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-border px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
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
        className="mt-3 w-full rounded-md bg-slate-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        {s.addTaskBtn}
      </button>
    </form>
  );
}
