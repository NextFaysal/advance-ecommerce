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
        name: u.name || "Staff",
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
      <h1 className="text-xl font-bold">অ্যানালিটিক্স (Analytics)</h1>
      <p role="note" className="mt-2 text-sm text-text-muted">
        Real order data from the database (last 365 days, Asia/Dhaka; cohort = all history). No AI model is used on this page; all figures are rule-based calculations.
      </p>

      <section className="mt-6">
        <h2 className="font-semibold">Overview</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border p-3"><div className="text-xs">Net revenue</div><div className="text-lg font-bold">{formatBdt(totalRevenue)}</div></div>
          <div className="rounded-xl border p-3"><div className="text-xs">Orders</div><div className="text-lg font-bold">{orderIds.size}</div></div>
          <div className="rounded-xl border p-3"><div className="text-xs">Customers in data</div><div className="text-lg font-bold">{rfm.length}</div></div>
          <div className="rounded-xl border p-3"><div className="text-xs">Average order value</div><div className="text-lg font-bold">{formatBdt(aov)}</div></div>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">সেলস ফানেল (Sales Funnel, last 30 days)</h2>
        {funnel.state === "not_collecting" ? (
          <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{funnel.messageBn}</p>
        ) : (
          <ul className="mt-2 text-sm">
            {funnel.steps.map((s) => (
              <li key={s.stage}>
                {s.stage}: {s.count} · আগের ধাপ থেকে {pct(s.conversionFromPreviousBps)} · শুরু থেকে {pct(s.conversionFromStartBps)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">Unit Economics</h2>
        <ul className="mt-2 text-sm">
          <li>LTV (গড় আয় / কাস্টমার): {formatBdt(ue.ltvPoisha)} — {customerCount} জন কাস্টমারের ওপর হিসাব করা</li>
          <li>CAC: — (বিজ্ঞাপন খরচ ট্র্যাক করা হয় না, তাই হিসাব করা যায় না)</li>
          <li>LTV : CAC: {ue.ltvToCacBps === null ? "— (CAC অজানা)" : `${(ue.ltvToCacBps / 10000).toFixed(2)}x`}</li>
          <li>ROAS: {ue.roasBps === null ? "— (বিজ্ঞাপন খরচ ট্র্যাক করা হয় না)" : pct(ue.roasBps)}</li>
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">RFM Segments</h2>
        <ul className="mt-2 text-sm">
          {Object.entries(segments).map(([segment, count]) => (
            <li key={segment}>{segment}: {count}</li>
          ))}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">কোহর্ট রিটেনশন (Cohort Retention)</h2>
        {cohort.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">কোনো কাস্টমার ডেটা নেই।</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="border-b p-2">কোহর্ট (প্রথম অর্ডারের মাস)</th>
                  <th className="border-b p-2">কাস্টমার</th>
                  {Array.from({ length: maxCohortCells }, (_, i) => (
                    <th key={i} className="border-b p-2">মাস {i}</th>
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
        <p className="mt-2 text-xs text-text-muted">প্রতিটি সেলে: সেই মাসে সক্রিয় কাস্টমার / কোহর্টের মোট কাস্টমার (শতকরা হার)। বাতিল অর্ডার ধরা হয়নি।</p>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">Courier Performance</h2>
        <ul className="mt-2 text-sm">
          {couriers.map((c) => (
            <li key={c.provider}>
              {c.provider} — score {c.score}/100 · delivery {pct(c.deliveryRateBps)} · returns {pct(c.returnRateBps)}
            </li>
          ))}
        </ul>
        {couriers.length === 0 && <p className="mt-2 text-sm text-text-muted">No courier data in this period.</p>}
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">স্টাফ ও কল সেন্টার কর্মদক্ষতা (Staff Performance)</h2>
        {staffScores.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">কোনো স্টাফ হিস্টোরি পাওয়া যায়নি।</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="border-b p-2">স্টাফ নাম</th>
                  <th className="border-b p-2">প্রসেস করা অর্ডার</th>
                  <th className="border-b p-2">কনফার্মেশন রেট</th>
                  <th className="border-b p-2">SLA রেট</th>
                </tr>
              </thead>
              <tbody>
                {staffScores.map((s) => (
                  <tr key={s.staffId}>
                    <td className="border-b p-2 font-medium">{s.name}</td>
                    <td className="border-b p-2">{s.ordersProcessed} টি</td>
                    <td className="border-b p-2">{(s.confirmRateBps / 100).toFixed(1)}%</td>
                    <td className="border-b p-2">{(s.slaRateBps / 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-text-muted">কল লগ থেকে হিসাব করা (সর্বশেষ ১০০০টি এন্ট্রি)। API: GET /api/v1/admin/analytics/staff-performance</p>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">জেলা হিটম্যাপ (District Heatmap)</h2>
        {heatmap.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">এই সময়ে কোনো অর্ডার নেই।</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {heatmap.slice(0, 15).map((d) => (
              <li key={d.district} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{d.district}</span>
                  <span>{d.orders} অর্ডার · {pct(d.shareBps)} · {formatBdt(d.revenuePoisha)}</span>
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
        <p className="mt-2 text-xs text-text-muted">বারের দৈর্ঘ্য ও রঙের গাঢ়ত্ব সবচেয়ে ব্যস্ত জেলার তুলনায় (শীর্ষ ১৫টি জেলা)। API: GET /api/v1/admin/analytics/districts?from=&amp;to=</p>
      </section>
    </main>
  );
}
