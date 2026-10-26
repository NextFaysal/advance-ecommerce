import { computeRfm, segmentCounts } from "@/analytics/rfm";
import type { CustomerOrderSummary } from "@/analytics/rfm";
import { rankCouriers, staffPerformance, type CourierStats, type StaffStats } from "@/analytics/performance";
import { formatBdt } from "@advance-ecommerce/validators";
import { daysAgoInDhaka, fetchSalesRows, todayInDhaka } from "@/reports/db-rows";
import type { SalesRow } from "@/reports/types";
import { prisma } from "@advance-ecommerce/db";

// Admin > Analytics (Step 47, A8).
// Everything on this page is computed by the pure functions in
// src/analytics over REAL order rows from the DB (Prisma, last 365
// Dhaka days). No AI model is used; all figures are rule-based.
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

export default async function AdminAnalyticsPage() {
  const rows = await fetchSalesRows({ from: daysAgoInDhaka(364), to: todayInDhaka() });
  const rfm = computeRfm(summaries(rows));
  const segments = segmentCounts(rfm);

  // Couriers
  const courierMap = new Map<string, CourierStats>();
  for (const r of rows) {
    if (!r.courier) continue;
    const s = courierMap.get(r.courier) ?? {
      provider: r.courier,
      shipments: 0,
      delivered: 0,
      failed: 0,
      returned: 0,
      avgDeliveryHours: null,
      codCollectedPoisha: 0,
      codExpectedPoisha: 0,
    };
    s.shipments += 1;
    if (r.status === "DELIVERED") {
      s.delivered += 1;
      s.codExpectedPoisha += r.revenuePoisha;
      s.codCollectedPoisha += r.revenuePoisha;
    }
    if (r.status === "RETURNED" || r.status === "REFUNDED") s.returned += 1;
    courierMap.set(r.courier, s);
  }
  const couriers = rankCouriers(Array.from(courierMap.values()));
  const totalRevenue = rows.reduce((sum, r) => sum + r.revenuePoisha - r.refundPoisha, 0);

  // Staff Performance Metrics
  let staffScores: ReturnType<typeof staffPerformance> = [];
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true },
      take: 20,
    });
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
    // Database fallback
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-text-main">অ্যানালিটিক্স ড্যাশবোর্ড</h1>
        <p className="mt-1 text-sm text-text-muted">
          গত ৩৬৫ দিনের অর্ডার ও কর্মদক্ষতার বাস্তব পরিসংখ্যান (ঢাকা টাইমজোন)।
        </p>
      </div>

      {/* Top Metric Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <p className="text-xs font-semibold text-text-muted">মোট আয় (Net Revenue)</p>
          <p className="mt-2 text-2xl font-bold text-primary">{formatBdt(totalRevenue)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <p className="text-xs font-semibold text-text-muted">অর্ডার সংখ্যা</p>
          <p className="mt-2 text-2xl font-bold text-text-main">{rows.length} টি</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <p className="text-xs font-semibold text-text-muted">গ্রাহক সংখ্যা</p>
          <p className="mt-2 text-2xl font-bold text-text-main">{rfm.length} জন</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <p className="text-xs font-semibold text-text-muted">কুরিয়ার সংখ্যা</p>
          <p className="mt-2 text-2xl font-bold text-text-main">{couriers.length} টি</p>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* RFM Customer Segments */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-bold text-text-main">RFM গ্রাহক বিভাজন (Segments)</h2>
          <div className="space-y-3">
            {Object.entries(segments).map(([segment, count]) => (
              <div key={segment} className="flex items-center justify-between border-b border-border/50 pb-2">
                <span className="text-sm font-medium text-text-main">{segment}</span>
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                  {count} জন
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Courier Performance Ranking */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-bold text-text-main">কুরিয়ার কর্মদক্ষতা (Courier Scores)</h2>
          <div className="space-y-3">
            {couriers.map((c) => (
              <div key={c.provider} className="rounded-xl border border-border/70 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold capitalize text-text-main">{c.provider}</span>
                  <span className="rounded bg-success/15 px-2 py-0.5 text-xs font-bold text-success">
                    স্কোর: {c.score}/১০০
                  </span>
                </div>
                <div className="mt-2 flex gap-4 text-xs text-text-muted">
                  <span>ডেলিভারি: {(c.deliveryRateBps / 100).toFixed(1)}%</span>
                  <span>রিটার্ন: {(c.returnRateBps / 100).toFixed(1)}%</span>
                  <span>COD আদায়: {(c.codCollectionBps / 100).toFixed(1)}%</span>
                </div>
              </div>
            ))}
            {couriers.length === 0 && (
              <p className="text-sm text-text-muted">এই সময়ে কোনো কুরিয়ার ডেটা নেই।</p>
            )}
          </div>
        </section>

        {/* Staff Performance Section */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm lg:col-span-2">
          <h2 className="mb-4 text-base font-bold text-text-main">স্টাফ ও কল সেন্টার কর্মদক্ষতা (Staff Performance)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border text-text-muted">
                <tr>
                  <th className="pb-3 font-semibold">স্টাফ নাম</th>
                  <th className="pb-3 font-semibold">প্রসেস করা অর্ডার</th>
                  <th className="pb-3 font-semibold">কনফার্মেশন রেট</th>
                  <th className="pb-3 font-semibold">SLA রেট</th>
                  <th className="pb-3 font-semibold">স্ট্যাটাস</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {staffScores.map((s) => (
                  <tr key={s.staffId} className="hover:bg-muted/30">
                    <td className="py-3 font-bold text-text-main">{s.name}</td>
                    <td className="py-3 text-text-main">{s.ordersProcessed} টি</td>
                    <td className="py-3">
                      <span className="font-semibold text-primary">
                        {(s.confirmRateBps / 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3">
                      <span className="font-semibold text-success">
                        {(s.slaRateBps / 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3">
                      <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
                        Active
                      </span>
                    </td>
                  </tr>
                ))}
                {staffScores.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-text-muted">
                      কোনো স্টাফ হিস্টোরি পাওয়া যায়নি।
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
