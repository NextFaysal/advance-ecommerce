import { computeRfm, segmentCounts } from "@/analytics/rfm";
import type { CustomerOrderSummary } from "@/analytics/rfm";
import { rankCouriers, type CourierStats } from "@/analytics/performance";
import { formatBdt } from "@advance-ecommerce/validators";
import { daysAgoInDhaka, fetchSalesRows, todayInDhaka } from "@/reports/db-rows";
import type { SalesRow } from "@/reports/types";

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
  const totalRevenue = rows.reduce((sum, r) => sum + r.revenuePoisha - r.refundPoisha, 0);

  return (
    <main>
      <h1>Analytics</h1>
      <p role="note">Real order data from the database (last 365 days, Asia/Dhaka). No AI model is used on this page; all figures are rule-based calculations.</p>

      <section>
        <h2>Overview</h2>
        <p>Net revenue: {formatBdt(totalRevenue)} · Customers in data: {rfm.length}</p>
      </section>

      <section>
        <h2>RFM Segments</h2>
        <ul>
          {Object.entries(segments).map(([segment, count]) => (
            <li key={segment}>{segment}: {count}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Courier Performance</h2>
        <ul>
          {couriers.map((c) => (
            <li key={c.provider}>
              {c.provider} — score {c.score}/100 · delivery {(c.deliveryRateBps / 100).toFixed(1)}% · returns {(c.returnRateBps / 100).toFixed(1)}%
            </li>
          ))}
        </ul>
        {couriers.length === 0 && <p>No courier data in this period.</p>}
      </section>

      <section>
        <h2>Not available yet</h2>
        <p>Funnel (view → cart → checkout → order) needs storefront tracking events. LTV/CAC/ROAS need tracked ad spend. Both will appear here when those sources are wired — they are not estimated.</p>
      </section>
    </main>
  );
}
