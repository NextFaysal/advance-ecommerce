import { computeRfm, segmentCounts } from "@/analytics/rfm";
import type { CustomerOrderSummary } from "@/analytics/rfm";
import { rankCouriers, staffPerformance, type CourierStats, type StaffStats } from "@/analytics/performance";
import { prisma } from "@advance-ecommerce/db";
import { buildCohortTable, buildCustomerActivity } from "@/analytics/cohort";
import { averageOrderValuePoisha, computeUnitEconomics } from "@/analytics/unit-economics";
import { getFunnelData, resolveFunnelEventStore } from "@/analytics/funnel-events";
import { buildDistrictHeatmap } from "@/analytics/district-heatmap";
import { formatBdt } from "@advance-ecommerce/validators";
import { daysAgoInDhaka, fetchSalesRows, todayInDhaka } from "@/reports/db-rows";
import type { SalesRow } from "@/reports/types";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import { ANALYTICS_STRINGS, SEGMENT_LABEL_KEYS } from "./strings";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { DonutChart } from "@/components/ui/chart-kit";

// Admin > Analytics (Step 47, A8; wired out in ADV-8, doc 22).
// Everything on this page is computed by the pure functions in
// src/analytics over REAL order rows from the DB (Prisma, Asia/Dhaka).
// No AI model is used; all figures are rule-based. Sections whose data
// source does not exist yet say so honestly instead of estimating:
// the funnel needs persisted tracking events (none are stored yet —
// see src/analytics/funnel-events.ts), and CAC/ROAS need tracked ad
// spend, so they render null with the reason, never zero.
export const dynamic = "force-dynamic";

function summaries(rows: SalesRow[]): CustomerOrderSummary[] {
  const latest = rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0]?.date ?? "2000-01-01");
  const map = new Map<string, { orders: Set<string>; monetary: number; last: string }>();
  for (const r of rows) {
    if (r.status === "CANCELLED") continue;
    const e = map.get(r.customerId) ?? { orders: new Set<string>(), monetary: 0, last: r.date };
    e.orders.add(r.orderId);
    e.monetary += r.revenuePoisha - r.refundPoisha;
    if (r.date > e.last) e.last = r.date;
    map.set(r.customerId, e);
  }
  return Array.from(map.entries()).map(([customerId, v]) => ({
    customerId,
    recencyDays: Math.max(0, Math.round((Date.parse(latest) - Date.parse(v.last)) / 86400000)),
    frequency: v.orders.size,
    monetaryPoisha: v.monetary,
  }));
}

function pct(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

export default async function AdminAnalyticsPage() {
  const locale = await getRequestLocale();
  const t = pick(locale, ANALYTICS_STRINGS);
  const range = { from: daysAgoInDhaka(364), to: todayInDhaka() };
  const rows = await fetchSalesRows(range);
  // Cohort retention is all-history by definition (second full scan —
  // fine at this scale; both reads are the same indexed order query).
  const historyRows = await fetchSalesRows({ from: "2000-01-01", to: range.to });
  const rfm = computeRfm(summaries(rows));
  const segments = segmentCounts(rfm);
  const cohort = buildCohortTable(buildCustomerActivity(historyRows));
  const funnel = await getFunnelData({ from: daysAgoInDhaka(29), to: range.to }, resolveFunnelEventStore());
  const heatmap = buildDistrictHeatmap(rows);

  const courierMap = new Map<string, CourierStats>();
  for (const r of rows) {
    if (!r.courier) continue;
    const s = courierMap.get(r.courier) ?? {
      provider: r.courier, shipments: 0, delivered: 0, failed: 0, returned: 0,
      avgDeliveryHours: null, codCollectedPoisha: 0, codExpectedPoisha: 0,
    };
    s.shipments += 1;
    if (r.status === "DELIVERED") { s.delivered += 1; s.codExpectedPoisha += r.revenuePoisha; s.codCollectedPoisha += r.revenuePoisha; }
    if (r.status === "RETURNED" || r.status === "REFUNDED") s.returned += 1;
    courierMap.set(r.courier, s);
  }
  const couriers = rankCouriers(Array.from(courierMap.values()));
  // Staff performance (v2-merge, PR #1): call-center outcomes per agent
  // from real CallLogEntry rows, scored by the same pure functions the
  // staff-performance API route uses. Read failure degrades to an
  // empty section, never a page crash.
  let staffScores: ReturnType<typeof staffPerformance> = [];
  try {
    const users = await prisma.user.findMany({ select: { id: true, name: true }, take: 20 });
    const callLogs = await prisma.callLogEntry.findMany({
      select: { agentId: true, outcome: true, durationSeconds: true },
      take: 1000,
    });
    const staffMap = new Map<string, StaffStats>();
    for (const u of users) {
      staffMap.set(u.id, {
        staffId: u.id,
        name: u.name || t.staffFallbackName,
        ordersProcessed: 0,
        ordersConfirmed: 0,
        callsHandled: 0,
        slaMet: 0,
        slaTotal: 0,
      });
    }
    for (const log of callLogs) {
      if (!log.agentId) continue;
      const staff = staffMap.get(log.agentId);
      if (staff) {
        staff.ordersProcessed += 1;
        staff.callsHandled += 1;
        staff.slaTotal += 1;
        if (log.outcome === "CONFIRMED") staff.ordersConfirmed += 1;
        if (!log.durationSeconds || log.durationSeconds <= 600) staff.slaMet += 1;
      }
    }
    staffScores = staffPerformance(Array.from(staffMap.values()));
  } catch {
    staffScores = [];
  }
  const totalRevenue = rows.reduce((sum, r) => sum + r.revenuePoisha - r.refundPoisha, 0);
  const orderIds = new Set(rows.filter((r) => r.status !== "CANCELLED").map((r) => r.orderId));
  const customerCount = new Set(rows.map((r) => r.customerId)).size;
  const ue = computeUnitEconomics({
    revenuePoisha: totalRevenue,
    customers: customerCount,
    adSpendPoisha: 0,
    adAttributedRevenuePoisha: 0,
  });
  const aov = averageOrderValuePoisha(totalRevenue, orderIds.size);
  const maxCohortCells = cohort.reduce((m, r) => Math.max(m, r.cells.length), 0);

  return (
    <main className="min-w-0">
      <PageHeader title={t.title} description={t.note} />

      <div className="space-y-6">
        <section>
          <h2 className="font-display text-base font-semibold text-text-main">{t.overview}</h2>
          <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card>
              <p className="text-xs font-medium text-text-muted">{t.netRevenue}</p>
              <p className="tnum mt-1 text-kpi text-text-main">{formatBdt(totalRevenue)}</p>
            </Card>
            <Card>
              <p className="text-xs font-medium text-text-muted">{t.orders}</p>
              <p className="tnum mt-1 text-kpi text-text-main">{orderIds.size}</p>
            </Card>
            <Card>
              <p className="text-xs font-medium text-text-muted">{t.customersInData}</p>
              <p className="tnum mt-1 text-kpi text-text-main">{rfm.length}</p>
            </Card>
            <Card>
              <p className="text-xs font-medium text-text-muted">{t.aov}</p>
              <p className="tnum mt-1 text-kpi text-text-main">{formatBdt(aov)}</p>
            </Card>
          </div>
        </section>

        <Card>
          <h2 className="font-display text-base font-semibold text-text-main">{t.funnelTitle}</h2>
          {funnel.state === "not_collecting" ? (
            <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">{locale === "bn" ? funnel.messageBn : t.funnelNotCollecting}</p>
          ) : (
            <ul className="mt-2 divide-y divide-border/60 text-sm">
              {funnel.steps.map((s) => (
                <li key={s.stage} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                  <span className="font-medium text-text-main">{s.stage}</span>
                  <span className="tnum text-text-muted">
                    {s.count} · {t.funnelFromPrev} {pct(s.conversionFromPreviousBps)} · {t.funnelFromStart} {pct(s.conversionFromStartBps)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="font-display text-base font-semibold text-text-main">{t.unitEconomics}</h2>
          <ul className="mt-2 divide-y divide-border/60 text-sm">
            <li className="tnum py-2.5">{interpolate(t.ltvLine, { amount: formatBdt(ue.ltvPoisha), count: customerCount })}</li>
            <li className="py-2.5">{t.cacLine}</li>
            <li className="tnum py-2.5">{interpolate(t.ltvCacLine, { value: ue.ltvToCacBps === null ? t.cacUnknown : `${(ue.ltvToCacBps / 10000).toFixed(2)}x` })}</li>
            <li className="tnum py-2.5">{interpolate(t.roasLine, { value: ue.roasBps === null ? t.roasUnknown : pct(ue.roasBps) })}</li>
          </ul>
        </Card>

        <Card>
          <h2 className="font-display text-base font-semibold text-text-main">{t.rfmTitle}</h2>
          {Object.values(segments).reduce((a, b) => a + b, 0) > 0 ? (
            <div className="mt-3">
              <DonutChart
                data={Object.entries(segments).map(([segment, count]) => ({
                  label: SEGMENT_LABEL_KEYS[segment] ? t[SEGMENT_LABEL_KEYS[segment]] : segment,
                  value: count,
                  displayValue: String(count),
                }))}
                ariaLabel={t.rfmTitle}
              />
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-border/60 text-sm">
              {Object.entries(segments).map(([segment, count]) => (
                <li key={segment} className="flex items-baseline justify-between gap-2 py-2.5">
                  <span>{SEGMENT_LABEL_KEYS[segment] ? t[SEGMENT_LABEL_KEYS[segment]] : segment}</span>
                  <span className="tnum font-medium">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <section>
          <h2 className="font-display text-base font-semibold text-text-main">{t.cohortTitle}</h2>
          {cohort.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">{t.cohortEmpty}</p>
          ) : (
            <div className="mt-3">
              <DataTable
                columns={[
                  { key: "month", header: t.cohortColMonth },
                  { key: "customers", header: t.cohortColCustomers },
                  ...Array.from({ length: maxCohortCells }, (_, i) => ({
                    key: `m${i}`,
                    header: interpolate(t.cohortMonth, { n: i }),
                  })),
                ]}
                rows={cohort.map((row) => {
                  const cells: Record<string, React.ReactNode> = {
                    month: <span className="font-medium">{row.cohortMonth}</span>,
                    customers: <span className="tnum">{row.size}</span>,
                  };
                  for (let i = 0; i < maxCohortCells; i++) {
                    const cell = row.cells[i];
                    cells[`m${i}`] = (
                      <span className="tnum">{cell ? `${cell.activeCustomers}/${row.size} (${pct(cell.retentionBps)})` : "—"}</span>
                    );
                  }
                  return cells;
                })}
              />
            </div>
          )}
          <p className="mt-2 text-xs text-text-muted">{t.cohortNote}</p>
        </section>

        <Card>
          <h2 className="font-display text-base font-semibold text-text-main">{t.courierTitle}</h2>
          <ul className="mt-2 divide-y divide-border/60 text-sm">
            {couriers.map((c) => (
              <li key={c.provider} className="tnum py-2.5">
                {interpolate(t.courierLine, { provider: c.provider, score: c.score, delivery: pct(c.deliveryRateBps), returns: pct(c.returnRateBps) })}
              </li>
            ))}
          </ul>
          {couriers.length === 0 && <p className="mt-2 text-sm text-text-muted">{t.courierEmpty}</p>}
        </Card>

        <section>
          <h2 className="font-display text-base font-semibold text-text-main">{t.staffTitle}</h2>
          {staffScores.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">{t.staffEmpty}</p>
          ) : (
            <div className="mt-3">
              <DataTable
                columns={[
                  { key: "name", header: t.staffColName },
                  { key: "orders", header: t.staffColOrders },
                  { key: "confirm", header: t.staffColConfirm },
                  { key: "sla", header: t.staffColSla },
                ]}
                rows={staffScores.map((s) => ({
                  name: <span className="font-medium">{s.name}</span>,
                  orders: <span className="tnum">{interpolate(t.staffOrdersCell, { count: s.ordersProcessed })}</span>,
                  confirm: <span className="tnum">{(s.confirmRateBps / 100).toFixed(1)}%</span>,
                  sla: <span className="tnum">{(s.slaRateBps / 100).toFixed(1)}%</span>,
                }))}
              />
            </div>
          )}
          <p className="mt-2 text-xs text-text-muted">{t.staffNote}</p>
        </section>

        <Card>
          <h2 className="font-display text-base font-semibold text-text-main">{t.heatmapTitle}</h2>
          {heatmap.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">{t.heatmapEmpty}</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {heatmap.slice(0, 15).map((d) => (
                <li key={d.district} className="text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-text-main">{d.district}</span>
                    <span className="tnum text-text-muted">{interpolate(t.heatmapOrders, { count: d.orders, share: pct(d.shareBps), revenue: formatBdt(d.revenuePoisha) })}</span>
                  </div>
                  <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-warning-solid"
                      style={{ width: `${Math.max(2, Math.round(d.intensity * 100))}%`, opacity: 0.35 + d.intensity * 0.65 }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-text-muted">{t.heatmapNote}</p>
        </Card>
      </div>
    </main>
  );
}
