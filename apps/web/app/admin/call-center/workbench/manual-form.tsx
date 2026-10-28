"use client";

/**
 * Manual task form (CD1 split) — markup and behaviour verbatim from
 * the monolith; the shell owns the field state and the submit handler
 * (createManual) and passes them down.
 */
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
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
    <form onSubmit={onSubmit} className="rounded-2xl border border-border/60 p-4 shadow-xs">
      <h3 className="font-display text-sm font-semibold text-text-main">{s.manualTitle}</h3>
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
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
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
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          />
        </label>
        <label className="block text-sm">
          <span className="text-text-muted">{s.noteLabel}</span>
          <input
            type="text"
            maxLength={500}
            value={mNote}
            onChange={(e) => onNoteChange(e.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          />
        </label>
      </div>
      {mError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {mError}
        </p>
      ) : null}
      {mNotice ? (
        <p role="status" className="mt-2 text-sm text-success-solid">
          {mNotice}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={mBusy}
        className="mt-3 w-full"
      >
        {s.addTaskBtn}
      </Button>
    </form>
  );
}
