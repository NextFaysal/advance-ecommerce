"use client";

// Audit log browser — wired to the real DB-backed API
// (GET /api/v1/admin/audit-log, permission audit.view) on 2026-10-25,
// replacing the hardcoded SAMPLE rows this page used to render.
// Filters (actor / action / entity / date range) and pagination are
// the API's own query parameters. Export posts to
// POST /api/v1/admin/audit-log/export with a mandatory reason — the
// export itself is recorded in the AuditLog table.
import { useCallback, useEffect, useState } from "react";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable, DataTableSkeleton } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, type Locale } from "@/i18n/locale";
import { AUDIT_STRINGS } from "./strings";

interface AuditEntry {
  id: string;
  actorId: string | null;
  actorLabel: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  sensitive: boolean;
  createdAt: string; // ISO
}

interface Filters {
  actor: string;
  action: string;
  entity: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { actor: "", action: "", entity: "", from: "", to: "" };
const PAGE_SIZE = 20;

function formatDhakaTime(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(intlLocale(locale), {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function buildQuery(filters: Filters, page: number): string {
  const params = new URLSearchParams();
  if (filters.actor.trim() !== "") params.set("actor", filters.actor.trim());
  if (filters.action.trim() !== "") params.set("action", filters.action.trim());
  if (filters.entity.trim() !== "") params.set("entity", filters.entity.trim());
  if (filters.from !== "") params.set("from", filters.from);
  if (filters.to !== "") params.set("to", filters.to);
  params.set("page", String(page));
  params.set("pageSize", String(PAGE_SIZE));
  return params.toString();
}

export function AuditClient() {
  const { locale } = useLocale();
  const t = AUDIT_STRINGS[locale];
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [exportOpen, setExportOpen] = useState(false);
  const [exportReason, setExportReason] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportDone, setExportDone] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/admin/audit-log?${buildQuery(applied, page)}`);
      const body = (await res.json().catch(() => null)) as
        | { data?: { entries: AuditEntry[]; total: number }; error?: { code: string; message: string } }
        | null;
      if (res.ok && body?.data) {
        setEntries(body.data.entries);
        setTotal(body.data.total);
      } else {
        setEntries([]);
        setTotal(0);
        setError(body?.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`);
      }
    } catch {
      setEntries([]);
      setTotal(0);
      setError(t.networkError);
    } finally {
      setLoading(false);
    }
  }, [applied, page, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sensitiveOnPage = entries.filter((e) => e.sensitive).length;
  const withReasonOnPage = entries.filter((e) => e.reason !== null && e.reason.trim() !== "").length;

  const rows = entries.map((e) => ({
    time: <span className="tnum whitespace-nowrap">{formatDhakaTime(e.createdAt, locale)}</span>,
    actor: <span className="font-medium">{e.actorLabel ?? e.actorId ?? t.systemActor}</span>,
    action: (
      <span className="inline-flex items-center gap-2">
        <span className="font-mono text-xs">{e.action}</span>
        {e.sensitive ? <Badge tone="warning">{t.sensitiveBadge}</Badge> : null}
      </span>
    ),
    entity: (
      <span className="font-mono text-xs">
        {e.entityType}
        {e.entityId ? ` · ${e.entityId}` : ""}
      </span>
    ),
    reason: e.sensitive ? (
      <span className="block rounded-lg bg-warning-soft px-2 py-1 text-xs font-medium text-warning-solid">
        {interpolate(t.reasonRequired, { reason: e.reason ?? "—" })}
      </span>
    ) : e.reason !== null ? (
      <span className="text-xs">{e.reason}</span>
    ) : (
      <span className="text-xs text-text-subtle">{t.notApplicable}</span>
    ),
  }));

  function applyFilters() {
    setPage(1);
    setApplied(draft);
  }

  function resetFilters() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  }

  async function confirmExport() {
    if (exportBusy) return;
    if (exportReason.trim() === "") {
      setExportError(t.exportReasonRequired);
      return;
    }
    setExportBusy(true);
    setExportError("");
    setExportDone("");
    try {
      const payload: Record<string, string> = { reason: exportReason.trim() };
      if (applied.actor.trim() !== "") payload.actor = applied.actor.trim();
      if (applied.action.trim() !== "") payload.action = applied.action.trim();
      if (applied.entity.trim() !== "") payload.entity = applied.entity.trim();
      if (applied.from !== "") payload.from = applied.from;
      if (applied.to !== "") payload.to = applied.to;
      const res = await fetch("/api/v1/admin/audit-log/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as
        | { data?: { filename: string; csv: string; rowCount: number }; error?: { code: string; message: string } }
        | null;
      if (res.ok && body?.data) {
        const blob = new Blob([body.data.csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = body.data.filename;
        a.click();
        URL.revokeObjectURL(url);
        setExportDone(interpolate(t.exportDone, { count: body.data.rowCount }));
        setExportOpen(false);
        setExportReason("");
        void load();
      } else {
        setExportError(body?.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`);
      }
    } catch {
      setExportError(t.networkError);
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t.statTotal} value={String(total)} delta={t.statTotalDelta} icon={<Icon name="info" size={22} />} />
        <StatCard label={t.statSensitive} value={String(sensitiveOnPage)} delta={t.statSensitiveDelta} deltaTone="down" icon={<Icon name="alert" size={22} />} />
        <StatCard label={t.statWithReason} value={String(withReasonOnPage)} delta={t.statWithReasonDelta} icon={<Icon name="check" size={22} />} />
        <StatCard label={t.statRetention} value={t.statRetentionValue} delta={t.statRetentionDelta} icon={<Icon name="shield" size={22} />} />
      </div>

      <Card>
        <p className="mb-3 font-display text-base font-semibold text-text-main">{t.filtersTitle}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            name="audit-actor"
            label={t.filterActor}
            placeholder={t.filterActorPlaceholder}
            value={draft.actor}
            onChange={(e) => setDraft((d) => ({ ...d, actor: e.target.value }))}
          />
          <Input
            name="audit-action"
            label={t.filterAction}
            placeholder={t.filterActionPlaceholder}
            value={draft.action}
            onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))}
          />
          <Input
            name="audit-entity"
            label={t.filterEntity}
            placeholder={t.filterEntityPlaceholder}
            value={draft.entity}
            onChange={(e) => setDraft((d) => ({ ...d, entity: e.target.value }))}
          />
          <Input
            name="audit-from"
            label={t.filterFrom}
            type="date"
            value={draft.from}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
          />
          <Input
            name="audit-to"
            label={t.filterTo}
            type="date"
            value={draft.to}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
          />
        </div>
        <div className="mt-4 flex gap-2">
          <Button type="button" onClick={applyFilters}>
            {t.applyFilters}
          </Button>
          <Button type="button" variant="outline" onClick={resetFilters}>
            {t.reset}
          </Button>
        </div>
      </Card>

      <div className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-text-main">{t.recentActivity}</h2>
        {error ? (
          <Card className="border-danger/40 bg-danger-soft text-sm text-danger">
            {interpolate(t.readError, { error })}
          </Card>
        ) : loading ? (
          <div className="space-y-3">
            <p role="status" className="text-sm text-text-muted">{t.loading}</p>
            <DataTableSkeleton columns={5} rows={6} />
          </div>
        ) : entries.length === 0 ? (
        <Card>
          <p className="text-sm text-text-muted">{t.empty}</p>
        </Card>
      ) : (
        <>
          <DataTable
            caption={t.tableCaption}
            columns={[
              { key: "time", header: t.colTime },
              { key: "actor", header: t.colActor },
              { key: "action", header: t.colAction },
              { key: "entity", header: t.colEntity },
              { key: "reason", header: t.colReason },
            ]}
            rows={rows}
          />
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-sm text-text-muted">
              {interpolate(t.pagination, { total, page, pages: totalPages })}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t.prevPage}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {t.nextPage}
              </Button>
            </div>
          </div>
          </>
        )}
      </div>

      <Card>
        <p className="font-display text-base font-semibold text-text-main">{t.exportRulesTitle}</p>
        <p className="mt-1 text-sm text-text-muted">{t.exportRules}</p>
        {exportDone ? (
          <p role="status" className="mt-3 rounded-xl bg-success-soft px-3 py-2 text-sm text-success-solid">
            {exportDone}
          </p>
        ) : null}
        <div className="mt-4">
          <Button type="button" variant="outline" onClick={() => setExportOpen(true)}>
            {t.exportButton}
          </Button>
        </div>
      </Card>

      <Modal
        open={exportOpen}
        onClose={() => {
          if (!exportBusy) setExportOpen(false);
        }}
        title={t.exportModalTitle}
        onConfirm={() => void confirmExport()}
      >
        <p className="text-small leading-relaxed">{t.exportModalBody}</p>
        <label className="mb-1.5 mt-4 block text-small font-medium" htmlFor="audit-export-reason">
          {t.exportReasonLabel}
        </label>
        <input
          id="audit-export-reason"
          value={exportReason}
          onChange={(e) => setExportReason(e.target.value)}
          placeholder={t.exportReasonPlaceholder}
          className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        {exportError && (
          <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-small text-danger">
            {exportError}
          </p>
        )}
        {exportBusy && <p className="mt-3 text-small text-text-muted">{t.exportBusy}</p>}
      </Modal>
    </div>
  );
}
