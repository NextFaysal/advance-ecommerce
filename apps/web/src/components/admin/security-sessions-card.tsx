"use client";

/**
 * Active staff sessions card — /admin/security (ADV-28 core).
 *
 * Self-fetching: GET /api/v1/admin/security/sessions on mount and
 * after every revoke. Revoking is a two-step inline flow (no modal):
 * "Revoke" opens a reason field in place; the API requires the
 * reason and audits it. The caller's own current session is badged
 * and its revoke button is disabled — the API also refuses it (409),
 * the disabled state just makes the rule visible before a wasted call.
 */
import { Fragment, useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, pick, type Locale } from "@/i18n/locale";
import { ADMIN_STRINGS, type AdminStrings } from "@/admin/strings";

interface SessionRow {
  id: string;
  userName: string | null;
  userEmail: string | null;
  roleName: string | null;
  ip: string | null;
  userAgent: string | null;
  deviceName: string | null;
  lastUsedAt: string;
  createdAt: string;
  isCurrent: boolean;
}

interface SessionsResponse {
  data?: SessionRow[];
  error?: { message?: string };
}

function fmtNum(n: number, locale: Locale): string {
  return n.toLocaleString(intlLocale(locale), { useGrouping: false });
}

/** "এখনই / ৫ মিনিট আগে / ২ ঘণ্টা আগে / ৩ দিন আগে", then a plain date. */
function relative(iso: string, locale: Locale, s: AdminStrings): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return s.secSessJustNow;
  const minutes = Math.floor(diffSec / 60);
  if (minutes < 60) return interpolate(s.secSessMinutesAgo, { count: fmtNum(minutes, locale) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return interpolate(s.secSessHoursAgo, { count: fmtNum(hours, locale) });
  const days = Math.floor(hours / 24);
  if (days < 30) return interpolate(s.secSessDaysAgo, { count: fmtNum(days, locale) });
  return new Date(iso).toLocaleDateString(intlLocale(locale), { day: "numeric", month: "short", year: "numeric" });
}

function absolute(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(intlLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Device column: the login-time device name if one was recorded,
 * otherwise a shortened user agent (full string stays in the title). */
function deviceSummary(row: SessionRow, s: AdminStrings): string {
  if (row.deviceName) return row.deviceName;
  if (!row.userAgent) return s.secSessUnknownDevice;
  return row.userAgent.length > 64 ? `${row.userAgent.slice(0, 64)}…` : row.userAgent;
}

export function SecuritySessionsCard() {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/security/sessions");
      const body = (await res.json().catch(() => ({}))) as SessionsResponse;
      if (!res.ok || !body.data) {
        setError(body.error?.message ?? s.secSessLoadFailed);
        setRows(null);
        return;
      }
      setError(null);
      setRows(body.data);
    } catch {
      setError(s.secSessNetworkError);
      setRows(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(row: SessionRow) {
    setBusyId(row.id);
    setActionError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/admin/security/sessions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: row.id, reason: reason.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setActionError(body.error?.message ?? s.secSessRevokeFailed);
        return;
      }
      setConfirmingId(null);
      setReason("");
      setNotice(s.secSessRevoked);
      await load();
    } catch {
      setActionError(s.secSessNetworkError);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-text-main">{s.secSessTitle}</h2>
          <p className="mt-1 text-sm text-text-muted">
            {s.secSessDesc}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          {s.secSessRefresh}
        </Button>
      </div>

      {notice ? (
        <p role="status" className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {actionError}
        </p>
      ) : null}

      {error ? (
        <div className="mt-4">
          <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
            {s.secSessRetry}
          </Button>
        </div>
      ) : rows === null ? (
        <p role="status" className="mt-4 text-sm text-text-muted">
          {s.secSessLoading}
        </p>
      ) : rows.length === 0 ? (
        <p role="status" className="mt-4 text-sm text-text-muted">
          {s.secSessEmpty}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-text-subtle">
                <th scope="col" className="py-2 pr-4 font-semibold">{s.secSessUser}</th>
                <th scope="col" className="py-2 pr-4 font-semibold">{s.secSessDevice}</th>
                <th scope="col" className="py-2 pr-4 font-semibold">IP</th>
                <th scope="col" className="py-2 pr-4 font-semibold">{s.secSessLastActive}</th>
                <th scope="col" className="py-2 font-semibold">{s.secSessAction}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <tr className="border-b border-border/60 align-top">
                    <td className="py-3 pr-4">
                      <span className="font-medium text-text-main">{row.userName ?? row.userEmail ?? "—"}</span>
                      {row.userName && row.userEmail ? (
                        <span className="block text-xs text-text-muted">{row.userEmail}</span>
                      ) : null}
                      {row.roleName ? (
                        <span className="mt-1 block">
                          <Badge tone="neutral">{row.roleName}</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 text-text-muted">
                      <span title={row.userAgent ?? undefined}>{deviceSummary(row, s)}</span>
                      <span className="block text-xs text-text-subtle">{s.secSessLoginAt}: {absolute(row.createdAt, locale)}</span>
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-text-muted">{row.ip ?? "—"}</td>
                    <td className="py-3 pr-4 text-text-muted" title={absolute(row.lastUsedAt, locale)}>
                      {relative(row.lastUsedAt, locale, s)}
                    </td>
                    <td className="py-3">
                      {row.isCurrent ? (
                        <div className="flex flex-col items-start gap-1.5">
                          <Badge tone="success" dot>
                            {s.secSessCurrent}
                          </Badge>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled
                            title={s.secSessOwnTitle}
                          >
                            {s.secSessRevoke}
                          </Button>
                        </div>
                      ) : confirmingId === row.id ? (
                        <span className="text-xs font-medium text-text-muted">{s.secSessReasonHint}</span>
                      ) : (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            setConfirmingId(row.id);
                            setReason("");
                            setActionError(null);
                          }}
                        >
                          {s.secSessRevoke}
                        </Button>
                      )}
                    </td>
                  </tr>
                  {confirmingId === row.id && !row.isCurrent ? (
                    <tr className="border-b border-border/60 bg-rose-50/50">
                      <td colSpan={5} className="py-3 pr-4">
                        <p className="text-sm font-medium text-text-main">
                          {interpolate(s.secSessConfirmText, { user: row.userName ?? row.userEmail ?? s.secSessThatUser })}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <div className="min-w-[260px] flex-1">
                            <Input
                              id="revoke-reason"
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              placeholder={s.secSessReasonPlaceholder}
                              aria-label={s.secSessReasonLabel}
                            />
                          </div>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            loading={busyId === row.id}
                            disabled={reason.trim() === ""}
                            onClick={() => void revoke(row)}
                          >
                            {s.secSessConfirmRevoke}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setConfirmingId(null);
                              setReason("");
                            }}
                          >
                            {s.secSessKeep}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
