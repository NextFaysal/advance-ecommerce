"use client";

/**
 * Download re-issue desk (doc 18, batch F3) — REAL data from
 * GET /api/v1/admin/downloads; decisions via
 * POST /api/v1/admin/downloads/[id]/approve|reject.
 *
 * WHY THIS EXISTS: a DownloadGrant stores only the SHA-256 hash of
 * its token — the raw link is unrecoverable BY DESIGN. A customer
 * who loses it (or lets it expire / exhausts it) files a re-issue
 * request from their account; staff decide here.
 *
 * APPROVE mints a NEW grant (same file/order, fresh 7-day / 5-use
 * budget), revokes the OLD grant — both redemption paths (token
 * link and account access) refuse revoked grants — and the response
 * shows the new grant's one-time download link ONCE, in the notice
 * below, for staff to relay if needed. It is never stored; the
 * customer can equally just use the Download button in their
 * account, which needs no link at all.
 *
 * REJECT requires a reason and never touches the old grant.
 * Customer phones arrive MASKED from the API.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, pick, type Locale } from "@/i18n/locale";
import { DOWNLOADS_STRINGS, type DownloadsStrings } from "./strings";

interface ReissueItem {
  id: string;
  grantId: string;
  status: string;
  reason: string | null;
  decisionNote: string | null;
  newGrantId: string | null;
  createdAt: string;
  customerName: string;
  customerPhoneMasked: string;
  orderId: string;
  orderNo: string;
  productName: string;
  fileName: string;
  grantStatus: "active" | "expired" | "exhausted" | "revoked";
  grantExpiresAt: string;
  grantDownloadsUsed: number;
  grantMaxDownloads: number;
}

interface OrderGrant {
  grantId: string;
  fileName: string;
  productName: string;
  issuedAt: string;
  expiresAt: string;
  downloadsUsed: number;
  maxDownloads: number;
  status: "active" | "expired" | "exhausted" | "revoked";
  reissuePending: boolean;
}

/* OD6 (doc 19 §3-S6) — request + grant states in the OD0 visual shape
 * ({ tone, icon, labelBn }); icons verified against
 * src/components/ui/icon.tsx. */
type Visual = { tone: "success" | "warning" | "danger" | "neutral"; icon: IconName; label: string };

function requestVisual(s: DownloadsStrings): Record<string, Visual> {
  return {
    PENDING: { tone: "warning", icon: "clock", label: s.reqPending },
    APPROVED: { tone: "success", icon: "check", label: s.reqApproved },
    REJECTED: { tone: "danger", icon: "x", label: s.reqRejected },
  };
}

function grantVisual(s: DownloadsStrings): Record<string, Visual> {
  return {
    active: { tone: "success", icon: "check", label: s.grantActive },
    expired: { tone: "warning", icon: "clock", label: s.grantExpired },
    exhausted: { tone: "warning", icon: "alert", label: s.grantExhausted },
    revoked: { tone: "danger", icon: "x", label: s.grantRevoked },
  };
}

function filters(s: DownloadsStrings): { key: string; label: string }[] {
  return [
    { key: "", label: s.filterAll },
    { key: "PENDING", label: s.reqPending },
    { key: "APPROVED", label: s.reqApproved },
    { key: "REJECTED", label: s.reqRejected },
  ];
}

const inputCls =
  "h-10 w-full rounded-md border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

function fmtDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(intlLocale(locale), {
    timeZone: "Asia/Dhaka",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function AdminDownloadsPage() {
  const { locale } = useLocale();
  const s = pick(locale, DOWNLOADS_STRINGS);
  const REQUEST_VISUAL = requestVisual(s);
  const GRANT_VISUAL = grantVisual(s);
  const FILTERS = filters(s);
  const [rows, setRows] = useState<ReissueItem[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("PENDING");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [oneTimeLink, setOneTimeLink] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  // Grant lookup by order.
  const [lookupRef, setLookupRef] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<{ orderNo: string; grants: OrderGrant[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (status) qs.set("status", status);
      const res = await fetch(`/api/v1/admin/downloads?${qs.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      setRows(json.data ?? []);
      setTotal(json.meta?.total ?? 0);
      setCounts(json.meta?.counts ?? {});
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : s.loadFailed);
      setRows([]);
    }
  }, [page, status, s]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(row: ReissueItem, kind: "approve" | "reject") {
    const note = (notes[row.id] ?? "").trim();
    if (kind === "reject" && note === "") {
      setActionError(s.rejectNeedsNote);
      return;
    }
    setBusyId(row.id);
    setActionError(null);
    setNotice(null);
    setOneTimeLink(null);
    try {
      const res = await fetch(`/api/v1/admin/downloads/${row.id}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(note ? { note } : {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      if (kind === "approve") {
        setNotice(s.approvedNotice);
        if (typeof json.data?.downloadPath === "string") {
          setOneTimeLink(json.data.downloadPath);
        }
      } else {
        setNotice(s.rejectedNotice);
      }
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : s.actionFailed);
    } finally {
      setBusyId(null);
    }
  }

  async function runLookup() {
    const ref = lookupRef.trim();
    if (ref === "") return;
    setLookupBusy(true);
    setLookupError(null);
    setLookupResult(null);
    try {
      const res = await fetch(`/api/v1/admin/downloads/lookup?orderNo=${encodeURIComponent(ref)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      setLookupResult({ orderNo: json.data.orderNo, grants: json.data.grants ?? [] });
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : s.lookupFailed);
    } finally {
      setLookupBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={s.title}
        description={s.description}
      />

      {notice !== null ? (
        <p role="status" className="rounded-md bg-success-50 px-3.5 py-2.5 text-small text-success-700">
          {notice}
          {oneTimeLink !== null ? (
            <span className="mt-2 block">
              <span className="font-semibold">{s.oneTimeLinkLabel}</span>{" "}
              <code className="break-all rounded bg-surface/70 px-1.5 py-0.5 text-xs">{oneTimeLink}</code>
            </span>
          ) : null}
        </p>
      ) : null}
      {actionError !== null ? (
        <p role="alert" className="rounded-md bg-danger-50 px-3.5 py-2.5 text-small text-danger-700">{actionError}</p>
      ) : null}
      {loadError !== null ? (
        <p role="alert" className="rounded-md bg-danger-50 px-3.5 py-2.5 text-small text-danger-700">{loadError}</p>
      ) : null}

      <Card className="p-4">
        <h2 className="text-sm font-bold text-text-main">{s.lookupTitle}</h2>
        <div className="mt-3 flex gap-2">
          <input
            value={lookupRef}
            onChange={(e) => setLookupRef(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runLookup();
            }}
            placeholder={s.lookupPlaceholder}
            className={inputCls}
          />
          <Button type="button" onClick={() => void runLookup()} disabled={lookupBusy} className="shrink-0">
            {lookupBusy ? s.searching : s.search}
          </Button>
        </div>
        {lookupError !== null ? <p className="mt-2 text-sm leading-6 text-danger-700">{lookupError}</p> : null}
        {lookupResult !== null ? (
          lookupResult.grants.length === 0 ? (
            <p className="mt-3 text-sm leading-6 text-text-muted">
              {interpolate(s.noGrants, { orderNo: lookupResult.orderNo })}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {lookupResult.grants.map((g) => (
                <li
                  key={g.grantId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-text-main">
                      {g.productName} — {g.fileName}
                    </span>
                    <span className="mt-0.5 block text-xs text-text-muted">
                      {interpolate(s.issuedLabel, { date: fmtDate(g.issuedAt, locale) })} ·{" "}
                      {interpolate(s.expiresLabel, { date: fmtDate(g.expiresAt, locale) })} ·{" "}
                      {interpolate(s.usageLabel, { used: g.downloadsUsed, max: g.maxDownloads })}
                      {g.reissuePending ? s.reissuePendingSuffix : ""}
                    </span>
                  </span>
                  <Badge
                    tone={GRANT_VISUAL[g.status]?.tone ?? "neutral"}
                    icon={<Icon name={GRANT_VISUAL[g.status]?.icon ?? "info"} size={12} />}
                  >
                    {GRANT_VISUAL[g.status]?.label ?? g.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => {
              setStatus(f.key);
              setPage(1);
            }}
            className={`rounded-full border px-3.5 py-1.5 text-small font-medium transition ${
              status === f.key
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-border bg-card text-text-muted hover:text-text-main"
            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300`}
          >
            {f.label}
            {f.key === "" ? (
              counts.ALL !== undefined ? (
                <span className="ml-1.5 text-caption text-text-subtle">{counts.ALL}</span>
              ) : null
            ) : (
              <span className="ml-1.5 text-caption text-text-subtle">{counts[f.key] ?? 0}</span>
            )}
          </button>
        ))}
        <span className="ml-auto text-xs text-text-muted">{interpolate(s.totalLabel, { total })}</span>
      </div>

      {rows === null ? (
        <div className="space-y-3" aria-hidden="true">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={s.emptyTitle}
          description={s.emptyDesc}
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-main">
                      {row.customerName}
                      <span className="ml-2 font-normal text-text-muted">{row.customerPhoneMasked}</span>
                    </p>
                    <p className="mt-1 text-sm leading-6 text-text-main">
                      {row.productName} — {row.fileName}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-text-muted">
                      {s.orderLabel}{" "}
                      <Link
                        href={`/admin/orders/${row.orderId}`}
                        className="font-semibold text-brand-700 hover:underline"
                      >
                        {row.orderNo}
                      </Link>{" "}
                      · {interpolate(s.requestedLabel, { date: fmtDate(row.createdAt, locale) })} ·{" "}
                      {interpolate(s.oldGrantLabel, {
                        used: row.grantDownloadsUsed,
                        max: row.grantMaxDownloads,
                        date: fmtDate(row.grantExpiresAt, locale),
                      })}
                    </p>
                    {row.reason ? (
                      <p className="mt-1 text-xs leading-5 text-text-muted">{interpolate(s.customerReason, { reason: row.reason })}</p>
                    ) : null}
                    {row.decisionNote ? (
                      <p className="mt-1 text-xs leading-5 text-text-muted">{interpolate(s.decisionNote, { note: row.decisionNote })}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Badge
                      tone={REQUEST_VISUAL[row.status]?.tone ?? "neutral"}
                      icon={<Icon name={REQUEST_VISUAL[row.status]?.icon ?? "info"} size={12} />}
                    >
                      {REQUEST_VISUAL[row.status]?.label ?? row.status}
                    </Badge>
                    <Badge
                      tone={GRANT_VISUAL[row.grantStatus]?.tone ?? "neutral"}
                      icon={<Icon name={GRANT_VISUAL[row.grantStatus]?.icon ?? "info"} size={12} />}
                    >
                      {interpolate(s.grantPrefix, { label: GRANT_VISUAL[row.grantStatus]?.label ?? row.grantStatus })}
                    </Badge>
                  </div>
                </div>

                {row.status === "PENDING" ? (
                  <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row">
                    <input
                      value={notes[row.id] ?? ""}
                      onChange={(e) => setNotes((prev) => ({ ...prev, [row.id]: e.target.value }))}
                      placeholder={s.notePlaceholder}
                      className={inputCls}
                    />
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => void decide(row, "approve")}
                        className="flex-1 sm:flex-initial"
                      >
                        {busyId === row.id ? s.working : s.approve}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busyId === row.id}
                        onClick={() => void decide(row, "reject")}
                        className="flex-1 sm:flex-initial"
                      >
                        {s.reject}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {total > pageSize ? (
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {s.prevPage}
          </Button>
          <span className="text-xs text-text-muted">
            {interpolate(s.pageLabel, { page, total: Math.ceil(total / pageSize) })}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={page >= Math.ceil(total / pageSize)}
            onClick={() => setPage((p) => p + 1)}
          >
            {s.nextPage}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
