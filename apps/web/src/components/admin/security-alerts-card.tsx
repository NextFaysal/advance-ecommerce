"use client";

/**
 * Security alerts card — /admin/security (ADV-28 core).
 *
 * Self-fetching: GET /api/v1/admin/security/alerts on mount; the API
 * returns newest first and this card renders in that order.
 * Unacknowledged alerts are highlighted and carry a "দেখেছি" button
 * that POSTs to /api/v1/admin/security/alerts/acknowledge and then
 * reloads the list. Kind values come from the alerts producer; the
 * badge maps the known kinds to Bangla and falls back to showing the
 * raw kind rather than inventing a label.
 */
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

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

function kindBadge(kind: string): { label: string; tone: BadgeTone } {
  const k = kind.toLowerCase();
  if (k.includes("lock")) return { label: "লকআউট", tone: "danger" };
  if (k.includes("new_ip") || k.includes("new-ip") || k.includes("newip")) {
    return { label: "নতুন IP থেকে লগইন", tone: "info" };
  }
  if (k.includes("fail")) return { label: "ব্যর্থ লগইন চেষ্টা", tone: "warning" };
  return { label: kind, tone: "neutral" };
}

function bn(n: number): string {
  return n.toLocaleString("bn-BD", { useGrouping: false });
}

/** "এখনই / ৫ মিনিট আগে / ২ ঘণ্টা আগে / ৩ দিন আগে", then a plain date. */
function relativeBn(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "এখনই";
  const minutes = Math.floor(diffSec / 60);
  if (minutes < 60) return `${bn(minutes)} মিনিট আগে`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${bn(hours)} ঘণ্টা আগে`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${bn(days)} দিন আগে`;
  return new Date(iso).toLocaleDateString("bn-BD", { day: "numeric", month: "short", year: "numeric" });
}

function absoluteBn(iso: string): string {
  return new Date(iso).toLocaleString("bn-BD", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SecurityAlertsCard() {
  const [alerts, setAlerts] = useState<SecurityAlert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/security/alerts");
      const body = (await res.json().catch(() => ({}))) as AlertsResponse;
      if (!res.ok || !body.data) {
        setError(body.error?.message ?? "সতর্কতা তালিকা লোড করা যায়নি — আবার চেষ্টা করুন।");
        setAlerts(null);
        return;
      }
      setError(null);
      setAlerts(body.data);
    } catch {
      setError("সার্ভারে পৌঁছানো যাচ্ছে না — নেটওয়ার্ক দেখে আবার চেষ্টা করুন।");
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
        setActionError(body.error?.message ?? "সতর্কতাটি পড়া হয়েছে হিসেবে চিহ্নিত করা যায়নি।");
        return;
      }
      await load();
    } catch {
      setActionError("সার্ভারে পৌঁছানো যাচ্ছে না — নেটওয়ার্ক দেখে আবার চেষ্টা করুন।");
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
            নিরাপত্তা সতর্কতা
            {alerts !== null && unacknowledgedCount > 0 ? (
              <span className="ml-2 align-middle">
                <Badge tone="danger" dot>
                  {bn(unacknowledgedCount)}টি নতুন
                </Badge>
              </span>
            ) : null}
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            লকআউট, ব্যর্থ লগইন চেষ্টা আর নতুন IP থেকে লগইনের মতো ঘটনা এখানে জমা হয়। দেখে
            ফেললে “দেখেছি” চাপুন — সতর্কতাটি পড়া হয়েছে হিসেবে চিহ্নিত থাকবে।
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          রিফ্রেশ
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
            আবার চেষ্টা করুন
          </Button>
        </div>
      ) : alerts === null ? (
        <p role="status" className="mt-4 text-sm text-text-muted">
          সতর্কতা লোড হচ্ছে…
        </p>
      ) : alerts.length === 0 ? (
        <p role="status" className="mt-4 text-sm text-text-muted">
          কোনো সতর্কতা নেই — লকআউট বা সন্দেহজনক লগইন ঘটলে এখানে দেখা যাবে।
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border/60">
          {alerts.map((alert) => {
            const badge = kindBadge(alert.kind);
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
                  <p className="mt-1 text-xs text-text-subtle" title={absoluteBn(alert.at)}>
                    {relativeBn(alert.at)} · {absoluteBn(alert.at)}
                  </p>
                </div>
                {alert.acknowledged ? (
                  <Badge tone="neutral">দেখা হয়েছে</Badge>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={busyId === alert.id}
                    onClick={() => void acknowledge(alert.id)}
                  >
                    দেখেছি
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
