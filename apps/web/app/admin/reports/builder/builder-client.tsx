"use client";

// Report Builder client (ADV-8). All data comes from the builder API
// routes (preview / export / saved / schedules) — this component only
// holds form state. Serializable props only (none). Money columns are
// integer poisha, labelled as such by the column catalogue.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  REPORT_COLUMNS,
  REPORT_DATASETS,
  type ReportDataset,
  type ReportDefinition,
} from "@/reports/builder";
import { SALES_STATUSES } from "@/reports/types";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { REPORTS_STRINGS } from "../strings";

interface PreviewData {
  columns: { key: string; label: string; type: string }[];
  rows: Record<string, string | number>[];
  totalRows: number;
  previewCapped: boolean;
}
interface SavedReport {
  id: string;
  name: string;
  definition: ReportDefinition;
}
interface Schedule {
  id: string;
  reportId: string;
  cadence: "daily" | "weekly";
  weekday: number | null;
  time: string;
  recipients: string[];
  enabled: boolean;
  lastSentAt: string | null;
}

function dhakaToday(): string {
  return new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
}
function dhakaDaysAgo(days: number): string {
  return new Date(Date.now() + 6 * 3600_000 - days * 86400000).toISOString().slice(0, 10);
}

export function BuilderClient() {
  const { locale } = useLocale();
  const str = pick(locale, REPORTS_STRINGS);
  const WEEKDAYS = [str.weekday0, str.weekday1, str.weekday2, str.weekday3, str.weekday4, str.weekday5, str.weekday6];
  const datasetLabel = (d: ReportDataset): string =>
    d === "orders" ? str.datasetOrders : d === "products" ? str.datasetProducts : str.datasetCustomers;
  const [dataset, setDataset] = useState<ReportDataset>("orders");
  const [columns, setColumns] = useState<string[]>(REPORT_COLUMNS.orders.slice(0, 6).map((c) => c.key));
  const [status, setStatus] = useState("");
  const [district, setDistrict] = useState("");
  const [courier, setCourier] = useState("");
  const [from, setFrom] = useState(dhakaDaysAgo(29));
  const [to, setTo] = useState(dhakaToday());
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [saveName, setSaveName] = useState("");
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [schedFor, setSchedFor] = useState("");
  const [cadence, setCadence] = useState<"daily" | "weekly">("daily");
  const [weekday, setWeekday] = useState(6);
  const [time, setTime] = useState("09:00");
  const [recipients, setRecipients] = useState("");
  const [runResult, setRunResult] = useState("");

  const definition = useMemo<ReportDefinition>(() => ({
    dataset,
    columns,
    filters: {
      ...(status !== "" ? { status } : {}),
      ...(district.trim() !== "" ? { district: district.trim() } : {}),
      ...(courier.trim() !== "" ? { courier: courier.trim() } : {}),
    },
    range: { from, to },
  }), [dataset, columns, status, district, courier, from, to]);

  const refreshLists = useCallback(async () => {
    const [s, sc] = await Promise.all([
      fetch("/api/v1/admin/reports/builder/saved").then((r) => r.json()).catch(() => null),
      fetch("/api/v1/admin/reports/builder/schedules").then((r) => r.json()).catch(() => null),
    ]);
    if (s?.data?.reports) setSaved(s.data.reports as SavedReport[]);
    if (sc?.data?.schedules) setSchedules(sc.data.schedules as Schedule[]);
  }, []);

  useEffect(() => { void refreshLists(); }, [refreshLists]);

  function changeDataset(next: ReportDataset) {
    setDataset(next);
    setColumns(REPORT_COLUMNS[next].slice(0, 6).map((c) => c.key));
    setPreview(null);
  }

  function toggleColumn(key: string) {
    setColumns((prev) => (prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]));
  }

  async function runPreview() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/v1/admin/reports/builder", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json?.error?.message ?? str.bPreviewFailed); setPreview(null); return; }
      setPreview(json.data as PreviewData);
    } finally { setBusy(false); }
  }

  async function runExport() {
    if (reason.trim() === "") { setError(str.bExportReasonRequired); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/v1/admin/reports/builder/export", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition, reason: reason.trim() }),
      });
      if (!res.ok) { const j = await res.json().catch(() => null); setError(j?.error?.message ?? str.bExportFailed); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `custom-report-${dataset}-${from}-to-${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally { setBusy(false); }
  }

  async function saveReport() {
    if (saveName.trim() === "") { setError(str.bSaveNameRequired); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/v1/admin/reports/builder/saved", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: saveName.trim(), definition }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json?.error?.message ?? str.bSaveFailed); return; }
      setSaveName("");
      await refreshLists();
    } finally { setBusy(false); }
  }

  function loadReport(report: SavedReport) {
    const d = report.definition;
    setDataset(d.dataset);
    setColumns(d.columns);
    setStatus(d.filters.status ?? "");
    setDistrict(d.filters.district ?? "");
    setCourier(d.filters.courier ?? "");
    setFrom(d.range.from);
    setTo(d.range.to);
    setPreview(null);
  }

  async function deleteReport(id: string) {
    await fetch(`/api/v1/admin/reports/builder/saved?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshLists();
  }

  async function createSchedule() {
    const list = recipients.split(",").map((s) => s.trim()).filter((s) => s !== "");
    if (schedFor === "" || list.length === 0) { setError(str.bScheduleNeedReportEmail); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/v1/admin/reports/builder/schedules", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportId: schedFor, cadence,
          weekday: cadence === "weekly" ? weekday : null,
          time, recipients: list, enabled: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json?.error?.message ?? str.bScheduleFailed); return; }
      setRecipients("");
      await refreshLists();
    } finally { setBusy(false); }
  }

  async function deleteSchedule(id: string) {
    await fetch(`/api/v1/admin/reports/builder/schedules?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshLists();
  }

  async function runDue() {
    setBusy(true); setRunResult("");
    try {
      const res = await fetch("/api/v1/admin/reports/builder/schedules/run-due", { method: "POST" });
      const json = await res.json();
      if (!res.ok) { setRunResult(json?.error?.message ?? str.bRunFailed); return; }
      const outcomes = (json.data?.outcomes ?? []) as { outcome: string; detail: string }[];
      setRunResult(outcomes.length === 0 ? str.bNoSchedules : outcomes.map((o) => `${o.outcome}: ${o.detail}`).join(" · "));
      await refreshLists();
    } finally { setBusy(false); }
  }

  const catalogue = REPORT_COLUMNS[dataset];

  return (
    <div className="mt-4 space-y-6">
      <section className="rounded-xl border p-4">
        <h2 className="font-semibold">{str.bDatasetColumnsTitle}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <label>{str.bDataset}
            <select className="ml-2 rounded border p-1.5" value={dataset} onChange={(e) => changeDataset(e.target.value as ReportDataset)}>
              {REPORT_DATASETS.map((d) => <option key={d} value={d}>{datasetLabel(d)}</option>)}
            </select>
          </label>
          <label>{str.bFrom} <input type="date" className="ml-1 rounded border p-1.5" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>{str.bTo} <input type="date" className="ml-1 rounded border p-1.5" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {catalogue.map((c) => (
            <label key={c.key} className="flex items-center gap-1.5 rounded border px-2 py-1">
              <input type="checkbox" checked={columns.includes(c.key)} onChange={() => toggleColumn(c.key)} />
              {c.label}
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <label>{str.bStatus}
            <select className="ml-2 rounded border p-1.5" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{str.bAll}</option>
              {SALES_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>{str.bDistrict} <input className="ml-1 rounded border p-1.5" value={district} onChange={(e) => setDistrict(e.target.value)} placeholder={str.bDistrictPlaceholder} /></label>
          <label>{str.bCourier} <input className="ml-1 rounded border p-1.5" value={courier} onChange={(e) => setCourier(e.target.value)} placeholder={str.bCourierPlaceholder} /></label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={busy || columns.length === 0} onClick={runPreview} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{str.bPreview}</button>
        </div>
        {error !== "" && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {preview && (
          <div className="mt-4 overflow-x-auto">
            <p className="text-sm">{preview.previewCapped ? interpolate(str.bTotalRowsCapped, { total: preview.totalRows }) : interpolate(str.bTotalRows, { total: preview.totalRows })}</p>
            <table className="mt-2 min-w-full text-left text-sm">
              <thead><tr>{preview.columns.map((c) => <th key={c.key} className="border-b p-2">{c.label}</th>)}</tr></thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i}>{preview.columns.map((c) => <td key={c.key} className="border-b p-2">{String(row[c.key] ?? "")}</td>)}</tr>
                ))}
              </tbody>
            </table>
            {preview.rows.length === 0 && <p className="mt-2 text-sm text-slate-500">{str.bNoDataCondition}</p>}
          </div>
        )}
      </section>

      <section className="rounded-xl border p-4">
        <h2 className="font-semibold">{str.bExportTitle}</h2>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <input className="min-w-64 rounded border p-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={str.bExportReasonPlaceholder} />
          <button type="button" disabled={busy || columns.length === 0} onClick={runExport} className="rounded-md border px-4 py-2 font-medium disabled:opacity-50">{str.bDownloadCsv}</button>
        </div>
      </section>

      <section className="rounded-xl border p-4">
        <h2 className="font-semibold">{str.bSavedTitle}</h2>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <input className="min-w-64 rounded border p-2" value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder={str.bReportNamePlaceholder} />
          <button type="button" disabled={busy} onClick={saveReport} className="rounded-md border px-4 py-2 font-medium disabled:opacity-50">{str.bSaveCurrent}</button>
        </div>
        <ul className="mt-3 space-y-1 text-sm">
          {saved.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.name}</span>
              <span className="text-slate-500">({datasetLabel(r.definition.dataset)}, {r.definition.range.from} → {r.definition.range.to})</span>
              <button type="button" className="rounded border px-2 py-0.5" onClick={() => loadReport(r)}>{str.bLoad}</button>
              <button type="button" className="rounded border px-2 py-0.5" onClick={() => void deleteReport(r.id)}>{str.bDelete}</button>
            </li>
          ))}
          {saved.length === 0 && <li className="text-slate-500">{str.bNoSaved}</li>}
        </ul>
      </section>

      <section className="rounded-xl border p-4">
        <h2 className="font-semibold">{str.bScheduleTitle}</h2>
        <p className="mt-1 text-sm text-slate-600">{str.bScheduleDesc}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <select className="rounded border p-1.5" value={schedFor} onChange={(e) => setSchedFor(e.target.value)}>
            <option value="">{str.bPickReport}</option>
            {saved.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select className="rounded border p-1.5" value={cadence} onChange={(e) => setCadence(e.target.value as "daily" | "weekly")}>
            <option value="daily">{str.bDaily}</option>
            <option value="weekly">{str.bWeekly}</option>
          </select>
          {cadence === "weekly" && (
            <select className="rounded border p-1.5" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
            </select>
          )}
          <input type="time" className="rounded border p-1.5" value={time} onChange={(e) => setTime(e.target.value)} />
          <input className="min-w-64 rounded border p-2" value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder={str.bEmailPlaceholder} />
          <button type="button" disabled={busy} onClick={createSchedule} className="rounded-md border px-4 py-2 font-medium disabled:opacity-50">{str.bAddSchedule}</button>
        </div>
        <ul className="mt-3 space-y-1 text-sm">
          {schedules.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2">
              <span>{saved.find((r) => r.id === s.reportId)?.name ?? s.reportId}</span>
              <span className="text-slate-500">{s.cadence === "weekly" ? str.bWeekly : str.bDaily}{s.cadence === "weekly" ? ` (${WEEKDAYS[s.weekday ?? 0]})` : ""} · {s.time} · {s.recipients.join(", ")} · {str.bLastSent} {s.lastSentAt ?? str.bNever}</span>
              <button type="button" className="rounded border px-2 py-0.5" onClick={() => void deleteSchedule(s.id)}>{str.bDelete}</button>
            </li>
          ))}
          {schedules.length === 0 && <li className="text-slate-500">{str.bNoSchedules}</li>}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <button type="button" disabled={busy} onClick={runDue} className="rounded-md border px-4 py-2 font-medium disabled:opacity-50">{str.bRunDue}</button>
          {runResult !== "" && <span>{runResult}</span>}
        </div>
      </section>
    </div>
  );
}
