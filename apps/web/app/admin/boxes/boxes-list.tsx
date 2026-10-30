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
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataTable, DataTableSkeleton } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
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
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/boxes/subscriptions");
      const json = (await res.json().catch(() => null)) as ListResponse | null;
      if (!res.ok || json?.data === undefined) {
        setError(json?.error?.message ?? s.listLoadFailed);
        return;
      }
      setRows(json.data.subscriptions);
      setEngineEnabled(json.meta?.engineEnabled ?? null);
    } catch {
      setError(s.listLoadFailedConn);
    }
  }, [s]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  async function handleRunSweep() {
    setSweeping(true);
    setSweepResult(null);
    try {
      const res = await fetch("/api/v1/admin/boxes/sweep", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setSweepResult(json?.error?.message ?? "সুইপ ব্যর্থ হয়েছে।");
      } else {
        const d = json.data;
        setSweepResult(
          `সুইপ সম্পন্ন: ${d.created}টি বক্স অর্ডার সফল, ${d.boxesSkipped}টি স্কিপড (কন্টেন্ট না থাকায়), ${d.failed}টি ব্যর্থ।`
        );
        await fetchList();
      }
    } catch {
      setSweepResult("সার্ভারের সাথে যোগাযোগ করা যায়নি।");
    } finally {
      setSweeping(false);
    }
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-text-main">{s.listTitle}</h2>
          <p className="mt-1 text-sm leading-6 text-text-muted">
            {s.workerNote}
            {engineEnabled === false ? ` ${s.engineOffNote}` : ""}
          </p>
        </div>
        <button
          type="button"
          disabled={sweeping}
          onClick={handleRunSweep}
          className="inline-flex min-h-10 items-center justify-center rounded-xl bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sweeping ? "অর্ডার তৈরি হচ্ছে…" : "⚡ এখনই সুইপ চালান (Run Sweep Now)"}
        </button>
      </div>

      {sweepResult ? (
        <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50/70 p-3 text-xs font-medium text-brand-900 dark:border-brand-500/30 dark:bg-brand-950/40 dark:text-brand-200">
          {sweepResult}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-danger">
          {error}
        </p>
      ) : rows === null ? (
        <div className="mt-4">
          <DataTableSkeleton columns={6} rows={5} />
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-4"><EmptyState title={s.listEmptyTitle} description={s.listEmptyDesc} /></div>
      ) : (
        <>
          <div className="mt-4 hidden md:block">
            <DataTable
              columns={[
                { key: "customer", header: s.colCustomer },
                { key: "box", header: s.colBox },
                { key: "cycle", header: s.colCycle },
                { key: "status", header: s.colStatus },
                { key: "nextCycle", header: s.colNextCycle },
                { key: "lastGen", header: s.colLastGen },
              ]}
              rows={rows.map(({ view: v, extra }) => ({
                customer: (
                  <>
                    <p className="font-medium text-text-main">{v.customerName}</p>
                    <p className="text-xs text-text-muted">{v.customerPhone}</p>
                  </>
                ),
                box: (
                  <>
                    <p className="font-medium text-text-main">
                      {v.productName} — {v.variantLabel}
                    </p>
                    <p className="tnum text-xs text-text-muted">
                      {formatBdt(v.unitPricePoisha)} × {v.quantity} · {v.sku}
                    </p>
                  </>
                ),
                cycle: (
                  <span className="text-text-muted">
                    {INTERVAL_LABELS[v.interval as SubscriptionInterval]?.[locale] ?? v.interval}
                  </span>
                ),
                status: (
                  <>
                    <Badge>{STATUS_LABELS[v.status]?.[locale] ?? v.status}</Badge>
                    {v.lastError ? (
                      <p className="mt-1 max-w-[260px] text-xs font-medium text-danger">
                        {v.lastError}
                      </p>
                    ) : null}
                  </>
                ),
                nextCycle: (
                  <>
                    <p className="text-text-main">{fmtDate(locale, v.nextRunAt)}</p>
                    <p className="text-xs text-text-muted">
                      {interpolate(s.cycleWord, { key: extra.nextCycleKey })}
                    </p>
                    {extra.nextContents ? (
                      <p className="text-xs font-medium text-success-solid">
                        {interpolate(s.contentsSet, { count: extra.nextContents.items.length })}
                      </p>
                    ) : (
                      <p className="text-xs font-medium text-warning-solid">{s.contentsMissing}</p>
                    )}
                  </>
                ),
                lastGen: v.lastRunAt ? (
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
                ),
              }))}
            />
          </div>
          <div className="mt-4 space-y-3 md:hidden">
            {rows.map(({ view: v, extra }) => (
              <div key={v.id} className="space-y-2 rounded-2xl border border-border bg-surface-2/50 p-4">
                <div>
                  <p className="text-xs font-medium text-text-muted">{s.colCustomer}</p>
                  <p className="font-medium text-text-main">{v.customerName}</p>
                  <p className="text-xs text-text-muted">{v.customerPhone}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-text-muted">{s.colBox}</p>
                  <p className="font-medium text-text-main">
                    {v.productName} — {v.variantLabel}
                  </p>
                  <p className="tnum text-xs text-text-muted">
                    {formatBdt(v.unitPricePoisha)} × {v.quantity} · {v.sku}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-text-muted">{s.colCycle}</p>
                  <p className="text-text-muted">
                    {INTERVAL_LABELS[v.interval as SubscriptionInterval]?.[locale] ?? v.interval}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-text-muted">{s.colStatus}</p>
                  <Badge>{STATUS_LABELS[v.status]?.[locale] ?? v.status}</Badge>
                  {v.lastError ? (
                    <p className="mt-1 text-xs font-medium text-danger">{v.lastError}</p>
                  ) : null}
                </div>
                <div>
                  <p className="text-xs font-medium text-text-muted">{s.colNextCycle}</p>
                  <p className="text-text-main">{fmtDate(locale, v.nextRunAt)}</p>
                  <p className="text-xs text-text-muted">
                    {interpolate(s.cycleWord, { key: extra.nextCycleKey })}
                  </p>
                  {extra.nextContents ? (
                    <p className="text-xs font-medium text-success-solid">
                      {interpolate(s.contentsSet, { count: extra.nextContents.items.length })}
                    </p>
                  ) : (
                    <p className="text-xs font-medium text-warning-solid">{s.contentsMissing}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium text-text-muted">{s.colLastGen}</p>
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
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
