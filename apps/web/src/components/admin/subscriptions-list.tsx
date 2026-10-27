"use client";

/**
 * Admin subscription list — /admin/subscriptions (ADV-18 remainder).
 *
 * Self-fetching: GET /api/v1/admin/subscriptions (orders.view). Read
 * only — customers manage their own subscriptions; staff visibility
 * exists so a merchant can see what WILL generate, what already
 * generated, and what failed (lastError is shown verbatim).
 *
 * HONEST GENERATION STATE: orders are created only by the worker
 * sweep (subscription-generation queue). Until a worker host runs,
 * ACTIVE rows pass their nextRunAt WITHOUT an order appearing — the
 * banner below says exactly that, in the page and not in a footnote.
 */
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatBdt } from "@/checkout/pricing";
import {
  INTERVAL_LABELS,
  STATUS_LABELS,
  type SubscriptionInterval,
} from "@/subscriptions/labels";
import type { SubscriptionView } from "@/subscriptions/service";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { ADMIN_STRINGS } from "@/admin/strings";

function fmtSubDate(locale: "bn" | "en", iso: string | null): string {
  if (iso === null) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(locale === "bn" ? "bn-BD" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
}

interface ListResponse {
  data?: { subscriptions: SubscriptionView[] };
  meta?: { moduleEnabled?: boolean; generation?: string };
  error?: { message?: string };
}

export function SubscriptionsList() {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  const [rows, setRows] = useState<SubscriptionView[] | null>(null);
  const [moduleEnabled, setModuleEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/admin/subscriptions");
        const json = (await res.json().catch(() => null)) as ListResponse | null;
        if (cancelled) return;
        if (!res.ok || json?.data === undefined) {
          setError(json?.error?.message ?? s.subsLoadFailed);
          return;
        }
        setRows(json.data.subscriptions);
        setModuleEnabled(json.meta?.moduleEnabled ?? null);
      } catch {
        if (!cancelled) setError(s.subsLoadFailedConn);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <Card className="border-amber-300/60 bg-amber-50 p-4 dark:border-amber-400/25 dark:bg-amber-500/10">
        <p className="text-sm leading-6 text-amber-900 dark:text-amber-100">
          {s.subsWorkerBody}
          {moduleEnabled === false
            ? s.subsFlagOff
            : ""}
        </p>
      </Card>

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : rows === null ? (
        <p className="text-sm text-text-muted">{s.subsLoading}</p>
      ) : rows.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-text-muted">{s.subsEmpty}</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-3 font-semibold">{s.subsCustomer}</th>
                <th className="px-4 py-3 font-semibold">{s.paletteProducts}</th>
                <th className="px-4 py-3 font-semibold">{s.subsInterval}</th>
                <th className="px-4 py-3 font-semibold">{s.subsStatus}</th>
                <th className="px-4 py-3 font-semibold">{s.subsNextRun}</th>
                <th className="px-4 py-3 font-semibold">{s.subsLastRun}</th>
                <th className="px-4 py-3 font-semibold">{s.subsOrdersCreated}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-border/60 align-top last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-text-main">{s.customerName}</p>
                    <p className="font-mono text-xs text-text-muted">{s.customerPhone}</p>
                    <p className="text-xs text-text-muted">
                      {s.address.upazila}, {s.address.district}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium leading-snug text-text-main">
                      {s.productName} — {s.variantLabel}
                    </p>
                    <p className="text-xs text-text-muted">
                      {s.sku} · {formatBdt(s.unitPricePoisha)} × {s.quantity} · {s.paymentMethod.toUpperCase()}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-text-main">
                    {INTERVAL_LABELS[s.interval as SubscriptionInterval]?.[locale] ?? s.interval}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={s.status === "ACTIVE" ? "success" : s.status === "PAUSED" ? "warning" : "neutral"}>
                      {STATUS_LABELS[s.status]?.[locale] ?? s.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-text-main">{fmtSubDate(locale, s.nextRunAt)}</td>
                  <td className="px-4 py-3">
                    <p className="text-text-main">{fmtSubDate(locale, s.lastRunAt)}</p>
                    {s.lastError ? (
                      <p className="mt-0.5 max-w-[260px] text-xs font-medium text-red-700 dark:text-red-300">
                        {s.lastError}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-text-main">{s.runCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
