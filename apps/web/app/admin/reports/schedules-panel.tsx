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

const WEEKDAYS = ["রবিবার (Sun)", "সোমবার (Mon)", "মঙ্গলবার (Tue)", "বুধবার (Wed)", "বৃহস্পতিবার (Thu)", "শুক্রবার (Fri)", "শনিবার (Sat)"];

export function ReportSchedulesPanel() {
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
      setError("সময়সূচির জন্য সংরক্ষিত রিপোর্ট ও অন্তত একটি ইমেইল দিন। (Pick a saved report and at least one email.)");
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
      setError("সংরক্ষণের জন্য কারণ আবশ্যক। (A reason is required to save schedules.)");
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
      if (!res.ok) { setError(json?.error?.message ?? "Save failed"); return; }
      if (json?.data?.schedules) setSchedules(json.data.schedules as ScheduleView[]);
      setReason("");
      setNotice("সংরক্ষিত হয়েছে। (Saved.)");
    } finally { setBusy(false); }
  }

  async function runDue() {
    setBusy(true); setRunResult("");
    try {
      const res = await fetch("/api/v1/admin/reports/builder/schedules/run-due", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setRunResult(json?.error?.message ?? "Run failed"); return; }
      const outcomes = (json?.data?.outcomes ?? []) as { outcome: string; detail: string }[];
      setRunResult(outcomes.length === 0 ? "কোনো সময়সূচি নেই।" : outcomes.map((o) => `${o.outcome}: ${o.detail}`).join(" · "));
      await refresh();
    } finally { setBusy(false); }
  }

  return (
    <section className="mt-6 rounded-xl border p-4">
      <h2 className="font-semibold">নির্ধারিত রিপোর্ট ডেলিভারি (Scheduled report delivery)</h2>
      <p className="mt-1 text-sm text-slate-500">
        সংরক্ষিত রিপোর্ট প্রতিদিন/প্রতি সপ্তাহে (ঢাকা সময়) ইমেইলে CSV সংযুক্তি হিসেবে যায়। Due চালালে শুধু ইমেইল job queue হয় —
        প্রকৃত পাঠানো worker host ও email transport-এর উপর নির্ভরশীল (queued ≠ sent)। Format: CSV only।
      </p>

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
              {s.cadence}{s.cadence === "weekly" ? ` (${WEEKDAYS[s.weekday ?? 0]})` : ""} · {s.time} · {s.recipients.join(", ")} ·
              শেষ পাঠানো: {s.lastSentAt ?? "কখনো না"}{s.lastPeriodKey ? ` (${s.lastPeriodKey})` : ""}
            </span>
            <button
              type="button"
              className="rounded border px-2 py-0.5"
              onClick={() => setSchedules((prev) => prev.filter((x) => x.id !== s.id))}
            >
              মুছুন
            </button>
          </li>
        ))}
        {schedules.length === 0 && <li className="text-slate-500">কোনো সময়সূচি নেই।</li>}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <select className="rounded border p-1.5" value={newReportId} onChange={(e) => setNewReportId(e.target.value)}>
          <option value="">সংরক্ষিত রিপোর্ট বেছে নিন</option>
          {saved.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select className="rounded border p-1.5" value={newCadence} onChange={(e) => setNewCadence(e.target.value as "daily" | "weekly")}>
          <option value="daily">প্রতিদিন (Daily)</option>
          <option value="weekly">সাপ্তাহিক (Weekly)</option>
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
          placeholder="ইমেইল (কমা দিয়ে একাধিক)"
        />
        <button type="button" disabled={busy} onClick={addSchedule} className="rounded-md border px-4 py-2 font-medium disabled:opacity-50">
          সময়সূচি যোগ করুন
        </button>
      </div>
      {saved.length === 0 && (
        <p className="mt-2 text-xs text-slate-500">আগে রিপোর্ট বিল্ডারে একটি রিপোর্ট সংরক্ষণ করুন — সময়সূচি শুধু সংরক্ষিত রিপোর্টেই দেওয়া যায়।</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <input
          className="min-w-64 rounded border p-2"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="পরিবর্তনের কারণ (আবশ্যক) — Reason (required)"
        />
        <button type="button" disabled={busy} onClick={saveAll} className="rounded-md border px-4 py-2 font-medium disabled:opacity-50">
          সব সংরক্ষণ করুন
        </button>
        <button type="button" disabled={busy} onClick={runDue} className="rounded-md border px-4 py-2 font-medium disabled:opacity-50">
          এখন due সময়সূচি চালান
        </button>
        {notice !== "" && <span>{notice}</span>}
        {runResult !== "" && <span>{runResult}</span>}
      </div>
      {error !== "" && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
