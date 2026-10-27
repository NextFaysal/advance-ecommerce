"use client";

/**
 * Admin box-subscription list — /admin/boxes (ADV-23 vertical 4).
 *
 * Self-fetching: GET /api/v1/admin/boxes/subscriptions
 * (orders.view). Read only — customers manage their own
 * subscriptions; this list exists so staff can see which box
 * cycles WILL generate, which already generated, which were
 * skipped for missing contents, and what failed (lastError shown
 * verbatim).
 *
 * HONEST GENERATION STATE: orders are created only by the worker
 * sweep. Until a worker host runs, ACTIVE rows pass their
 * nextRunAt WITHOUT an order appearing — stated in the banner,
 * mirroring the wave-51 admin list.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatBdt } from "@/checkout/pricing";
import {
  INTERVAL_LABELS,
  STATUS_LABELS,
  type SubscriptionInterval,
} from "@/subscriptions/labels";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, pick, type Locale } from "@/i18n/locale";
import { BOXES_STRINGS } from "./strings";

/** ISO timestamp -> a short localised date (labels.ts' formatter is bn-only). */
function fmtDate(locale: Locale, iso: string | null): string {
  if (iso === null) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(intlLocale(locale), { day: "numeric", month: "long", year: "numeric" });
}
import type { SubscriptionView } from "@/subscriptions/service";
import type { BoxSubscriptionExtra } from "@/boxes/service";

interface Row {
  view: SubscriptionView;
  extra: BoxSubscriptionExtra;
}

interface ListResponse {
  data?: { subscriptions: Row[] };
  meta?: { moduleEnabled?: boolean; engineEnabled?: boolean; generation?: string };
  error?: { message?: string };
}

export function BoxesList() {
  const { locale } = useLocale();
  const s = pick(locale, BOXES_STRINGS);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [engineEnabled, setEngineEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/admin/boxes/subscriptions");
        const json = (await res.json().catch(() => null)) as ListResponse | null;
        if (cancelled) return;
        if (!res.ok || json?.data === undefined) {
          setError(json?.error?.message ?? s.listLoadFailed);
          return;
        }
        setRows(json.data.subscriptions);
        setEngineEnabled(json.meta?.engineEnabled ?? null);
      } catch {
        if (!cancelled) setError(s.listLoadFailedConn);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="font-display text-base font-bold text-text-main">{s.listTitle}</h2>
      <p className="mt-1 text-sm leading-6 text-text-muted">
        {s.workerNote}
        {engineEnabled === false ? ` ${s.engineOffNote}` : ""}
      </p>

      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : rows === null ? (
        <p className="mt-3 text-sm text-text-muted">{s.loading}</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">{s.listEmpty}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
                <th className="py-2 pr-3 font-semibold">{s.colCustomer}</th>
                <th className="py-2 pr-3 font-semibold">{s.colBox}</th>
                <th className="py-2 pr-3 font-semibold">{s.colCycle}</th>
                <th className="py-2 pr-3 font-semibold">{s.colStatus}</th>
                <th className="py-2 pr-3 font-semibold">{s.colNextCycle}</th>
                <th className="py-2 pr-3 font-semibold">{s.colLastGen}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ view: v, extra }) => (
                <tr key={v.id} className="border-b border-border/60 align-top">
                  <td className="py-2.5 pr-3">
                    <p className="font-medium text-text-main">{v.customerName}</p>
                    <p className="text-xs text-text-muted">{v.customerPhone}</p>
                  </td>
                  <td className="py-2.5 pr-3">
                    <p className="font-medium text-text-main">
                      {v.productName} — {v.variantLabel}
                    </p>
                    <p className="text-xs text-text-muted">
                      {formatBdt(v.unitPricePoisha)} × {v.quantity} · {v.sku}
                    </p>
                  </td>
                  <td className="py-2.5 pr-3 text-text-muted">
                    {INTERVAL_LABELS[v.interval as SubscriptionInterval]?.[locale] ?? v.interval}
                  </td>
                  <td className="py-2.5 pr-3">
                    <Badge>{STATUS_LABELS[v.status]?.[locale] ?? v.status}</Badge>
                    {v.lastError ? (
                      <p className="mt-1 max-w-[260px] text-xs font-medium text-red-700 dark:text-red-300">
                        {v.lastError}
                      </p>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-3">
                    <p className="text-text-main">{fmtDate(locale, v.nextRunAt)}</p>
                    <p className="text-xs text-text-muted">
                      {interpolate(s.cycleWord, { key: extra.nextCycleKey })}
                    </p>
                    {extra.nextContents ? (
                      <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        {interpolate(s.contentsSet, { count: extra.nextContents.items.length })}
                      </p>
                    ) : (
                      <p className="text-xs font-medium text-amber-700 dark:text-amber-300">{s.contentsMissing}</p>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    {v.lastRunAt ? (
                      <>
                        <p className="text-text-main">{fmtDate(locale, v.lastRunAt)}</p>
                        <p className="text-xs text-text-muted">
                          {extra.lastCycleKey ? interpolate(s.cyclePrefix, { key: extra.lastCycleKey }) : ""}
                          {interpolate(s.totalRuns, { count: v.runCount })}
                        </p>
                        {v.lastOrderId ? (
                          <Link
                            href={`/admin/orders/${v.lastOrderId}`}
                            className="text-xs font-semibold text-brand-700 hover:underline"
                          >
                            {s.viewLastOrder}
                          </Link>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-text-muted">{s.notYet}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
