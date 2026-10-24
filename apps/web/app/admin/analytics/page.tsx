import { DEMO_SALES_ROWS } from "@/reports/demo";
import { computeRfm, segmentCounts } from "@/analytics/rfm";
import type { CustomerOrderSummary } from "@/analytics/rfm";
import { rankCouriers, type CourierStats } from "@/analytics/performance";
import { formatBdt } from "@advance-ecommerce/validators";

// Admin > Analytics (Step 47, A8) — demo-data page.
// Everything on this page is computed by the pure functions in
// src/analytics over TEMPORARY_DEMO rows. It is labelled as such in the
// UI; when order DB queries land, only the data source changes.
export const dynamic = "force-dynamic";

function summaries(): CustomerOrderSummary[] {
  const latest = DEMO_SALES_ROWS.reduce((m, r) => (r.date > m ? r.date : m), DEMO_SALES_ROWS[0]?.date ?? "2000-01-01");
  const map = new Map<string, { orders: Set<string>; monetary: number; last: string }>();
  for (const r of DEMO_SALES_ROWS) {
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

export default function AdminAnalyticsPage() {
  const rfm = computeRfm(summaries());
  const segments = segmentCounts(rfm);
  const courierMap = new Map<string, CourierStats>();
  for (const r of DEMO_SALES_ROWS) {
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
  const totalRevenue = DEMO_SALES_ROWS.reduce((sum, r) => sum + r.revenuePoisha - r.refundPoisha, 0);

  return (
    <main>
      <h1>Analytics</h1>
      <p role="note">Demo data (TEMPORARY_DEMO) — real order data will replace this source. No AI model is used on this page; all figures are rule-based calculations.</p>

      <section>
        <h2>Overview</h2>
        <p>Net revenue (demo): {formatBdt(totalRevenue)} · Customers in data: {rfm.length}</p>
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
        {couriers.length === 0 && <p>No courier data in the demo set.</p>}
      </section>

      <section>
        <h2>Not available yet</h2>
        <p>Funnel (view → cart → checkout → order) needs storefront tracking events. LTV/CAC/ROAS need tracked ad spend. Both will appear here when those sources are wired — they are not estimated.</p>
      </section>
    </main>
  );
}
