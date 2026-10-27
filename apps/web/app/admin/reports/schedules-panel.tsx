"use client";

// Scheduled report delivery panel (ADV-8, wave 52) — mounted on the
// main reports page. Self-fetching: reads the top-level schedules
// API (GET /api/v1/admin/reports/schedules) and the builder's saved
// reports for the picker; saves the whole list with one PUT
// (reason mandatory, audited — the reports export convention). The
// full per-item editor also lives in the report builder; both write
// the SAME `reports.schedules` document, so the two never diverge.
// Delivery honesty: a due run only QUEUES email jobs — the CSV is
// rebuilt and attached by the worker at send time, so delivery
// needs the worker host + a configured email transport.
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { REPORTS_STRINGS } from "./strings";

interface ScheduleView {
  id: string;
  reportId: string;
  name: string;
  cadence: "daily" | "weekly";
  weekday: number | null;
  time: string;
  recipients: string[];
  enabled: boolean;
  lastSentAt: string | null;
  lastPeriodKey: string | null;
}

interface SavedReportLite {
  id: string;
  name: string;
}

export function ReportSchedulesPanel() {
  const { locale } = useLocale();
  const str = pick(locale, REPORTS_STRINGS);
  const WEEKDAYS = [str.weekday0, str.weekday1, str.weekday2, str.weekday3, str.weekday4, str.weekday5, str.weekday6];
  const [schedules, setSchedules] = useState<ScheduleView[]>([]);
  const [saved, setSaved] = useState<SavedReportLite[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [runResult, setRunResult] = useState("");
  // Add-form state.
  const [newReportId, setNewReportId] = useState("");
  const [newCadence, setNewCadence] = useState<"daily" | "weekly">("daily");
  const [newWeekday, setNewWeekday] = useState(1);
  const [newTime, setNewTime] = useState("08:00");
  const [newRecipients, setNewRecipients] = useState("");

  const refresh = useCallback(async () => {
    const [sc, s] = await Promise.all([
      fetch("/api/v1/admin/reports/schedules").then((r) => r.json()).catch(() => null),
      fetch("/api/v1/admin/reports/builder/saved").then((r) => r.json()).catch(() => null),
    ]);
    if (sc?.data?.schedules) setSchedules(sc.data.schedules as ScheduleView[]);
    if (s?.data?.reports) setSaved(s.data.reports as SavedReportLite[]);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  function patchSchedule(id: string, patch: Partial<ScheduleView>) {
    setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function addSchedule() {
    const list = newRecipients.split(",").map((v) => v.trim()).filter((v) => v !== "");
    if (newReportId === "" || list.length === 0) {
      setError(str.schNeedReportEmail);
      return;
    }
    setError("");
    setSchedules((prev) => [
      ...prev,
      {
        id: `new-${crypto.randomUUID()}`,
        reportId: newReportId,
        name: saved.find((r) => r.id === newReportId)?.name ?? newReportId,
        cadence: newCadence,
        weekday: newCadence === "weekly" ? newWeekday : null,
        time: newTime,
        recipients: list,
        enabled: true,
        lastSentAt: null,
        lastPeriodKey: null,
      },
    ]);
    setNewRecipients("");
  }

  async function saveAll() {
    if (reason.trim() === "") {
      setError(str.schReasonRequired);
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await fetch("/api/v1/admin/reports/schedules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reason.trim(),
          schedules: schedules.map((s) => ({
            // New rows carry a client-minted placeholder id; the
            // server only preserves server-owned fields for ids it
            // already knows, and mints a real id otherwise.
            ...(s.id.startsWith("new-") ? {} : { id: s.id }),
            reportId: s.reportId,
            cadence: s.cadence,
            weekday: s.cadence === "weekly" ? s.weekday : null,
            time: s.time,
            recipients: s.recipients,
            enabled: s.enabled,
          })),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setError(json?.error?.message ?? str.schSaveFailed); return; }
      if (json?.data?.schedules) setSchedules(json.data.schedules as ScheduleView[]);
      setReason("");
      setNotice(str.schSavedNotice);
    } finally { setBusy(false); }
  }

  async function runDue() {
    setBusy(true); setRunResult("");
    try {
      const res = await fetch("/api/v1/admin/reports/builder/schedules/run-due", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setRunResult(json?.error?.message ?? str.schRunFailed); return; }
      const outcomes = (json?.data?.outcomes ?? []) as { outcome: string; detail: string }[];
      setRunResult(outcomes.length === 0 ? str.schNoSchedulesOutcome : outcomes.map((o) => `${o.outcome}: ${o.detail}`).join(" · "));
      await refresh();
    } finally { setBusy(false); }
  }

  return (
    <section className="mt-6 rounded-xl border p-4">
      <h2 className="font-semibold">{str.schTitle}</h2>
      <p className="mt-1 text-sm text-slate-500">{str.schDesc}</p>

      <ul className="mt-3 space-y-2 text-sm">
        {schedules.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={s.enabled}
                onChange={(e) => patchSchedule(s.id, { enabled: e.target.checked })}
              />
              <span>{s.name !== "" ? s.name : s.reportId}</span>
            </label>
            <span className="text-slate-500">
              {s.cadence === "weekly" ? str.schWeeklyOpt : str.schDailyOpt}{s.cadence === "weekly" ? ` (${WEEKDAYS[s.weekday ?? 0]})` : ""} · {s.time} · {s.recipients.join(", ")} ·
              {str.schLastSent} {s.lastSentAt ?? str.schNever}{s.lastPeriodKey ? ` (${s.lastPeriodKey})` : ""}
            </span>
            <button
              type="button"
              className="rounded border px-2 py-0.5"
              onClick={() => setSchedules((prev) => prev.filter((x) => x.id !== s.id))}
            >
              {str.schDelete}
            </button>
          </li>
        ))}
        {schedules.length === 0 && <li className="text-slate-500">{str.schNoSchedulesList}</li>}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <select className="rounded border p-1.5" value={newReportId} onChange={(e) => setNewReportId(e.target.value)}>
          <option value="">{str.schPickSavedReport}</option>
          {saved.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select className="rounded border p-1.5" value={newCadence} onChange={(e) => setNewCadence(e.target.value as "daily" | "weekly")}>
          <option value="daily">{str.schDailyOpt}</option>
          <option value="weekly">{str.schWeeklyOpt}</option>
        </select>
        {newCadence === "weekly" && (
          <select className="rounded border p-1.5" value={newWeekday} onChange={(e) => setNewWeekday(Number(e.target.value))}>
            {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
          </select>
        )}
        <input type="time" className="rounded border p-1.5" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
        <input
          className="min-w-64 rounded border p-2"
          value={newRecipients}
          onChange={(e) => setNewRecipients(e.target.value)}
          placeholder={str.schEmailPlaceholder}
        />
        <button type="button" disabled={busy} onClick={addSchedule} className="rounded-md border px-4 py-2 font-medium disabled:opacity-50">
          {str.schAddSchedule}
        </button>
      </div>
      {saved.length === 0 && (
        <p className="mt-2 text-xs text-slate-500">{str.schSaveFirstNote}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <input
          className="min-w-64 rounded border p-2"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={str.schReasonPlaceholder}
        />
        <button type="button" disabled={busy} onClick={saveAll} className="rounded-md border px-4 py-2 font-medium disabled:opacity-50">
          {str.schSaveAll}
        </button>
        <button type="button" disabled={busy} onClick={runDue} className="rounded-md border px-4 py-2 font-medium disabled:opacity-50">
          {str.schRunDue}
        </button>
        {notice !== "" && <span>{notice}</span>}
        {runResult !== "" && <span>{runResult}</span>}
      </div>
      {error !== "" && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
