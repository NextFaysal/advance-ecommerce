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
      <h1 className="text-xl font-bold">{t.title}</h1>
      <p role="note" className="mt-2 text-sm text-text-muted">
        {t.note}
      </p>

      <section className="mt-6">
        <h2 className="font-semibold">{t.overview}</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border p-3"><div className="text-xs">{t.netRevenue}</div><div className="text-lg font-bold">{formatBdt(totalRevenue)}</div></div>
          <div className="rounded-xl border p-3"><div className="text-xs">{t.orders}</div><div className="text-lg font-bold">{orderIds.size}</div></div>
          <div className="rounded-xl border p-3"><div className="text-xs">{t.customersInData}</div><div className="text-lg font-bold">{rfm.length}</div></div>
          <div className="rounded-xl border p-3"><div className="text-xs">{t.aov}</div><div className="text-lg font-bold">{formatBdt(aov)}</div></div>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">{t.funnelTitle}</h2>
        {funnel.state === "not_collecting" ? (
          <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{locale === "bn" ? funnel.messageBn : t.funnelNotCollecting}</p>
        ) : (
          <ul className="mt-2 text-sm">
            {funnel.steps.map((s) => (
              <li key={s.stage}>
                {s.stage}: {s.count} · {t.funnelFromPrev} {pct(s.conversionFromPreviousBps)} · {t.funnelFromStart} {pct(s.conversionFromStartBps)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">{t.unitEconomics}</h2>
        <ul className="mt-2 text-sm">
          <li>{interpolate(t.ltvLine, { amount: formatBdt(ue.ltvPoisha), count: customerCount })}</li>
          <li>{t.cacLine}</li>
          <li>{interpolate(t.ltvCacLine, { value: ue.ltvToCacBps === null ? t.cacUnknown : `${(ue.ltvToCacBps / 10000).toFixed(2)}x` })}</li>
          <li>{interpolate(t.roasLine, { value: ue.roasBps === null ? t.roasUnknown : pct(ue.roasBps) })}</li>
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">{t.rfmTitle}</h2>
        <ul className="mt-2 text-sm">
          {Object.entries(segments).map(([segment, count]) => (
            <li key={segment}>{SEGMENT_LABEL_KEYS[segment] ? t[SEGMENT_LABEL_KEYS[segment]] : segment}: {count}</li>
          ))}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">{t.cohortTitle}</h2>
        {cohort.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">{t.cohortEmpty}</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="border-b p-2">{t.cohortColMonth}</th>
                  <th className="border-b p-2">{t.cohortColCustomers}</th>
                  {Array.from({ length: maxCohortCells }, (_, i) => (
                    <th key={i} className="border-b p-2">{interpolate(t.cohortMonth, { n: i })}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohort.map((row) => (
                  <tr key={row.cohortMonth}>
                    <td className="border-b p-2 font-medium">{row.cohortMonth}</td>
                    <td className="border-b p-2">{row.size}</td>
                    {Array.from({ length: maxCohortCells }, (_, i) => {
                      const cell = row.cells[i];
                      return (
                        <td key={i} className="border-b p-2">
                          {cell ? `${cell.activeCustomers}/${row.size} (${pct(cell.retentionBps)})` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-text-muted">{t.cohortNote}</p>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">{t.courierTitle}</h2>
        <ul className="mt-2 text-sm">
          {couriers.map((c) => (
            <li key={c.provider}>
              {interpolate(t.courierLine, { provider: c.provider, score: c.score, delivery: pct(c.deliveryRateBps), returns: pct(c.returnRateBps) })}
            </li>
          ))}
        </ul>
        {couriers.length === 0 && <p className="mt-2 text-sm text-text-muted">{t.courierEmpty}</p>}
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">{t.staffTitle}</h2>
        {staffScores.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">{t.staffEmpty}</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="border-b p-2">{t.staffColName}</th>
                  <th className="border-b p-2">{t.staffColOrders}</th>
                  <th className="border-b p-2">{t.staffColConfirm}</th>
                  <th className="border-b p-2">{t.staffColSla}</th>
                </tr>
              </thead>
              <tbody>
                {staffScores.map((s) => (
                  <tr key={s.staffId}>
                    <td className="border-b p-2 font-medium">{s.name}</td>
                    <td className="border-b p-2">{interpolate(t.staffOrdersCell, { count: s.ordersProcessed })}</td>
                    <td className="border-b p-2">{(s.confirmRateBps / 100).toFixed(1)}%</td>
                    <td className="border-b p-2">{(s.slaRateBps / 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-text-muted">{t.staffNote}</p>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">{t.heatmapTitle}</h2>
        {heatmap.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">{t.heatmapEmpty}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {heatmap.slice(0, 15).map((d) => (
              <li key={d.district} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{d.district}</span>
                  <span>{interpolate(t.heatmapOrders, { count: d.orders, share: pct(d.shareBps), revenue: formatBdt(d.revenuePoisha) })}</span>
                </div>
                <div className="mt-1 h-2.5 w-full overflow-hidden rounded bg-slate-100">
                  <div
                    className="h-full rounded bg-orange-500"
                    style={{ width: `${Math.max(2, Math.round(d.intensity * 100))}%`, opacity: 0.35 + d.intensity * 0.65 }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-text-muted">{t.heatmapNote}</p>
      </section>
    </main>
  );
}
