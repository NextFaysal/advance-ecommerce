"use client";

/**
 * Security alerts card — /admin/security (ADV-28 core).
 *
 * Self-fetching: GET /api/v1/admin/security/alerts on mount; the API
 * returns newest first and this card renders in that order.
 * Unacknowledged alerts are highlighted and carry a "Seen" button
 * that POSTs to /api/v1/admin/security/alerts/acknowledge and then
 * reloads the list. Kind values come from the alerts producer; the
 * badge maps the known kinds to Bangla and falls back to showing the
 * raw kind rather than inventing a label.
 */
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, pick, type Locale } from "@/i18n/locale";
import { ADMIN_STRINGS, type AdminStrings } from "@/admin/strings";

interface SecurityAlert {
  id: string;
  kind: string;
  identifier: string | null;
  ip: string | null;
  detail: string | null;
  at: string;
  acknowledged: boolean;
}

interface AlertsResponse {
  data?: SecurityAlert[];
  error?: { message?: string };
}

type BadgeTone = "brand" | "success" | "warning" | "danger" | "info" | "neutral";

function kindBadge(kind: string, s: AdminStrings): { label: string; tone: BadgeTone } {
  const k = kind.toLowerCase();
  if (k.includes("lock")) return { label: s.secAlertLockout, tone: "danger" };
  if (k.includes("new_ip") || k.includes("new-ip") || k.includes("newip")) {
    return { label: s.secAlertNewIp, tone: "info" };
  }
  if (k.includes("fail")) return { label: s.secAlertFailedLogin, tone: "warning" };
  return { label: kind, tone: "neutral" };
}

function fmtNum(n: number, locale: Locale): string {
  return n.toLocaleString(intlLocale(locale), { useGrouping: false });
}

/** "এখনই / ৫ মিনিট আগে / ২ ঘণ্টা আগে / ৩ দিন আগে", then a plain date. */
function relative(iso: string, locale: Locale, s: AdminStrings): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return s.secJustNow;
  const minutes = Math.floor(diffSec / 60);
  if (minutes < 60) return interpolate(s.secMinutesAgo, { count: fmtNum(minutes, locale) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return interpolate(s.secHoursAgo, { count: fmtNum(hours, locale) });
  const days = Math.floor(hours / 24);
  if (days < 30) return interpolate(s.secDaysAgo, { count: fmtNum(days, locale) });
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

export function SecurityAlertsCard() {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  const [alerts, setAlerts] = useState<SecurityAlert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/security/alerts");
      const body = (await res.json().catch(() => ({}))) as AlertsResponse;
      if (!res.ok || !body.data) {
        setError(body.error?.message ?? s.secAlertsLoadFailed);
        setAlerts(null);
        return;
      }
      setError(null);
      setAlerts(body.data);
    } catch {
      setError(s.secAlertsNetworkError);
      setAlerts(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function acknowledge(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      const res = await fetch("/api/v1/admin/security/alerts/acknowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setActionError(body.error?.message ?? s.secAlertsAckFailed);
        return;
      }
      await load();
    } catch {
      setActionError(s.secAlertsNetworkError);
    } finally {
      setBusyId(null);
    }
  }

  const unacknowledgedCount = alerts?.filter((a) => !a.acknowledged).length ?? 0;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-text-main">
            {s.secAlertsTitle}
            {alerts !== null && unacknowledgedCount > 0 ? (
              <span className="ml-2 align-middle">
                <Badge tone="danger" dot>
                  {interpolate(s.secAlertsNew, { count: fmtNum(unacknowledgedCount, locale) })}
                </Badge>
              </span>
            ) : null}
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            {s.secAlertsDesc}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          {s.secRefresh}
        </Button>
      </div>

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
            {s.secRetry}
          </Button>
        </div>
      ) : alerts === null ? (
        <p role="status" className="mt-4 text-sm text-text-muted">
          {s.secAlertsLoading}
        </p>
      ) : alerts.length === 0 ? (
        <p role="status" className="mt-4 text-sm text-text-muted">
          {s.secAlertsEmpty}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border/60">
          {alerts.map((alert) => {
            const badge = kindBadge(alert.kind, s);
            return (
              <li
                key={alert.id}
                className={`flex flex-wrap items-start justify-between gap-3 py-3 ${
                  alert.acknowledged ? "" : "rounded-md bg-amber-50/60 px-3"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={badge.tone} dot={!alert.acknowledged}>
                      {badge.label}
                    </Badge>
                    {alert.identifier ? (
                      <span className="font-mono text-xs text-text-main">{alert.identifier}</span>
                    ) : null}
                    {alert.ip ? <span className="font-mono text-xs text-text-muted">IP: {alert.ip}</span> : null}
                  </div>
                  {alert.detail ? <p className="mt-1.5 text-sm text-text-muted">{alert.detail}</p> : null}
                  <p className="mt-1 text-xs text-text-subtle" title={absolute(alert.at, locale)}>
                    {relative(alert.at, locale, s)} · {absolute(alert.at, locale)}
                  </p>
                </div>
                {alert.acknowledged ? (
                  <Badge tone="neutral">{s.secSeen}</Badge>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={busyId === alert.id}
                    onClick={() => void acknowledge(alert.id)}
                  >
                    {s.secMarkSeen}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
