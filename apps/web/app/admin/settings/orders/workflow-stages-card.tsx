"use client";

// Workflow stages card — Settings > Orders (ADV-26, BUILD-LITE).
// Editor over the Settings JSON document `orders.workflow_stages`
// (src/orders/stages.ts): merchant-defined order workflow stages —
// LABELS anchored at one canonical status each, shown as chips next
// to the status badge and on customer tracking. Stages never change
// Order.status and never gate anything (money/stock/courier stay on
// the canonical machine).
//
// Saves go through PUT /api/v1/admin/orders/workflow-stages
// { stages, reason } — reason required, audited as
// orders.workflow_stages.update. The route is NOT the generic
// settings POST because the doc key lives outside SETTING_DEFAULTS
// (the restaurant.config precedent).
//
// ID LOCKING (the pickup-points rule): a stage's id is frozen into
// the `stage:<id>` tag on every order carrying it, so ids of saved
// stages are locked here; only a row added in this session has an
// editable id. Labels stay editable — renaming a label never
// rewrites history because orders store only the id.
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick, type Locale } from "@/i18n/locale";
import { SETTINGS_STRINGS, type SettingsStrings } from "../strings";
import { ORDER_STATUS_VISUAL } from "@/orders/components/labels";
import type { OrderStatus } from "@/orders/types";

export interface WorkflowStageRow {
  id: string;
  labelBn: string;
  labelEn: string;
  anchorStatus: OrderStatus;
  color?: "brand" | "success" | "warning" | "danger" | "info" | "neutral";
  sortOrder: number;
}

interface EditorRow extends WorkflowStageRow {
  isNew: boolean;
}

interface WorkflowStagesCardProps {
  initialStages: WorkflowStageRow[];
  /** True when a stored document exists. */
  storedConfigured: boolean;
  /** module.workflow_stages state — stages can be PREPARED while the
   *  add-on is OFF (config-prep precedent); they go live on flip. */
  moduleEnabled: boolean;
  dbReady: boolean;
}

const STATUSES = Object.keys(ORDER_STATUS_VISUAL) as OrderStatus[];
const TONES = ["brand", "success", "warning", "danger", "info", "neutral"] as const;
function toneLabel(s: SettingsStrings, tone: (typeof TONES)[number]): string {
  return { brand: s.wfToneBrand, success: s.wfToneSuccess, warning: s.wfToneWarning, danger: s.wfToneDanger, info: s.wfToneInfo, neutral: s.wfToneNeutral }[tone];
}
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_STAGES = 20;

function validateRows(rows: EditorRow[], locale: Locale): { stages: WorkflowStageRow[] } | { error: string } {
  const s = pick(locale, SETTINGS_STRINGS);
  if (rows.length > MAX_STAGES) return { error: interpolate(s.wfMaxError, { max: MAX_STAGES }) };
  const seen = new Set<string>();
  const stages: WorkflowStageRow[] = [];
  for (const row of rows) {
    const id = row.id.trim();
    if (!ID_PATTERN.test(id) || id.length > 40) {
      return { error: interpolate(s.wfIdError, { id: row.id }) };
    }
    if (seen.has(id)) return { error: interpolate(s.wfIdDup, { id }) };
    seen.add(id);
    if (row.labelBn.trim() === "") return { error: interpolate(s.wfBnEmpty, { id }) };
    if (row.labelEn.trim() === "") return { error: interpolate(s.wfEnEmpty, { id }) };
    stages.push({
      id,
      labelBn: row.labelBn.trim(),
      labelEn: row.labelEn.trim(),
      anchorStatus: row.anchorStatus,
      ...(row.color ? { color: row.color } : {}),
      sortOrder: Number.isFinite(row.sortOrder) ? Math.trunc(row.sortOrder) : 0,
    });
  }
  return { stages };
}

const inputCls =
  "min-h-[40px] w-full rounded-[9px] border border-border bg-card px-2.5 text-small text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300";

export function WorkflowStagesCard({ initialStages, storedConfigured, moduleEnabled, dbReady }: WorkflowStagesCardProps) {
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_STRINGS);
  const [rows, setRows] = useState<EditorRow[]>(() => initialStages.map((s) => ({ ...s, isNew: false })));
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [statusOk, setStatusOk] = useState(false);
  const [saving, setSaving] = useState(false);

  const patchRow = (idx: number, patch: Partial<EditorRow>) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const save = async () => {
    const validated = validateRows(rows, locale);
    if ("error" in validated) {
      setStatus(validated.error);
      setStatusOk(false);
      return;
    }
    if (reason.trim() === "") {
      setStatus(s.wfReasonRequired);
      setStatusOk(false);
      return;
    }
    setSaving(true);
    setStatus("");
    try {
      const res = await fetch("/api/v1/admin/orders/workflow-stages", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stages: validated.stages, reason: reason.trim() }),
      });
      const body = (await res.json().catch(() => null)) as
        | { data?: { config: { stages: WorkflowStageRow[] } }; error?: { code: string; message: string; details?: string[] } }
        | null;
      if (res.ok && body?.data) {
        setRows(body.data.config.stages.map((s) => ({ ...s, isNew: false })));
        setReason("");
        setStatus(s.wfSaved);
        setStatusOk(true);
      } else {
        const detail = body?.error?.details?.length ? ` (${body.error.details.join("; ")})` : "";
        setStatus(
          body?.error ? `${body.error.code}: ${body.error.message}${detail}` : `HTTP ${res.status}`,
        );
        setStatusOk(false);
      }
    } catch {
      setStatus(s.wfNetwork);
      setStatusOk(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-border/70 bg-card p-5 shadow-card">
      <h2 className="flex items-center gap-2.5 font-display text-base font-semibold text-text-main">
        <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-50 text-brand-600">
          <Icon name="tag" size={17} />
        </span>
        {s.wfTitle}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-text-muted">
        {s.wfDescA}<strong>{s.wfDescBold}</strong>{s.wfDescB}
      </p>
      {!moduleEnabled ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-small text-amber-800">
          {s.wfModuleOffA}<code className="font-mono text-xs">module.workflow_stages</code>{s.wfModuleOffB}
        </p>
      ) : null}
      {!storedConfigured ? (
        <p className="mt-2 text-small text-text-subtle">{s.wfNoneSaved}</p>
      ) : null}

      <div className="mt-4 space-y-3">
        {rows.map((row, idx) => (
          <div key={idx} className="rounded-lg border border-border p-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-caption font-semibold text-text-muted">{s.wfIdLabel}</span>
                <input
                  className={inputCls}
                  value={row.id}
                  disabled={!row.isNew}
                  onChange={(e) => patchRow(idx, { id: e.target.value })}
                  placeholder="quality-check"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-caption font-semibold text-text-muted">{s.wfAnchorLabel}</span>
                <select
                  className={inputCls}
                  value={row.anchorStatus}
                  onChange={(e) => patchRow(idx, { anchorStatus: e.target.value as OrderStatus })}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {locale === "bn" ? ORDER_STATUS_VISUAL[s].labelBn : ORDER_STATUS_VISUAL[s].labelEn} ({s})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-caption font-semibold text-text-muted">{s.wfColorLabel}</span>
                <select
                  className={inputCls}
                  value={row.color ?? ""}
                  onChange={(e) =>
                    patchRow(idx, {
                      color: e.target.value === "" ? undefined : (e.target.value as EditorRow["color"]),
                    })
                  }
                >
                  <option value="">{s.wfColorAuto}</option>
                  {TONES.map((t) => (
                    <option key={t} value={t}>
                      {toneLabel(s, t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-caption font-semibold text-text-muted">{s.wfLabelBn}</span>
                <input
                  className={inputCls}
                  value={row.labelBn}
                  onChange={(e) => patchRow(idx, { labelBn: e.target.value })}
                  placeholder={s.wfLabelBnPlaceholder}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-caption font-semibold text-text-muted">{s.wfLabelEn}</span>
                <input
                  className={inputCls}
                  value={row.labelEn}
                  onChange={(e) => patchRow(idx, { labelEn: e.target.value })}
                  placeholder={s.wfLabelEnPlaceholder}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-caption font-semibold text-text-muted">{s.wfSortLabel}</span>
                <input
                  className={inputCls}
                  type="number"
                  value={row.sortOrder}
                  onChange={(e) => patchRow(idx, { sortOrder: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                className="text-caption font-semibold text-rose-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
              >
                {s.wfDelete}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={rows.length >= MAX_STAGES}
          onClick={() =>
            setRows((prev) => [
              ...prev,
              { id: "", labelBn: "", labelEn: "", anchorStatus: "CONFIRMED", sortOrder: prev.length * 10, isNew: true },
            ])
          }
          className="inline-flex min-h-[40px] items-center rounded-md border border-border bg-card px-3 text-sm font-semibold text-text-main transition motion-fast hover:border-brand-300 disabled:opacity-50"
        >
          {s.wfAdd}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4">
        <label className="block min-w-[240px] flex-1">
          <span className="mb-1 block text-caption font-semibold text-text-muted">{s.wfReasonLabel}</span>
          <input
            className={inputCls}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={s.wfReasonPlaceholder}
          />
        </label>
        <button
          type="button"
          disabled={saving || !dbReady}
          onClick={() => void save()}
          className="inline-flex min-h-[40px] items-center rounded-md bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm transition motion-fast hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? s.wfSaving : s.wfSave}
        </button>
      </div>
      {status ? (
        <p role="status" className={`mt-3 text-small ${statusOk ? "text-emerald-700" : "text-rose-700"}`}>
          {status}
        </p>
      ) : null}
    </section>
  );
}
