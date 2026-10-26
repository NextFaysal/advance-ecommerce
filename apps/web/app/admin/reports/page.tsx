import { formatBdt } from "@advance-ecommerce/validators";
import { aggregateSales } from "@/reports/service";
import { daysAgoInDhaka, fetchSalesRows, todayInDhaka, withComparisonWindow } from "@/reports/db-rows";

// Admin reports — Step 28. Real DB rows (Prisma orders/order items,
// Asia/Dhaka dates), aggregated with the pure reports service (integer
// poisha). RBAC reports.view applies to the API; CSV via
// /api/v1/admin/reports/export.
export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  const range = { from: daysAgoInDhaka(29), to: todayInDhaka() };
  const rows = await fetchSalesRows(withComparisonWindow(range));
  const bundle = aggregateSales(rows, range, true);
  const t = bundle.totals;
  const sections: [string, Record<string, { orders: number; revenuePoisha: number }>][] = [
    ["District", bundle.byDistrict],
    ["Courier", bundle.byCourier],
    ["Product", bundle.byProduct],
  ];
  return (
    <main className="min-w-0">
      <h1 className="text-xl font-bold">রিপোর্ট (Reports)</h1>
      <p className="mt-2 text-sm">{range.from} → {range.to} (last 30 days, Asia/Dhaka, database)</p>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border p-3"><div className="text-xs">Orders</div><div className="text-lg font-bold">{t.orders}</div></div>
        <div className="rounded-xl border p-3"><div className="text-xs">Revenue</div><div className="text-lg font-bold">{formatBdt(t.revenuePoisha)}</div></div>
        <div className="rounded-xl border p-3"><div className="text-xs">Cost</div><div className="text-lg font-bold">{formatBdt(t.costPoisha)}</div></div>
        <div className="rounded-xl border p-3"><div className="text-xs">Gross profit (P&amp;L)</div><div className="text-lg font-bold">{formatBdt(t.grossProfitPoisha)}</div></div>
      </div>
      {bundle.comparison && <p className="mt-3 text-sm">Previous period revenue: {formatBdt(bundle.comparison.previous.revenuePoisha)} — delta: {bundle.comparison.revenueDeltaPercent === null ? "—" : `${bundle.comparison.revenueDeltaPercent}%`}</p>}
      {sections.map(([title, data]) => (
        <section key={title} className="mt-6">
          <h2 className="font-semibold">{title}</h2>
          {Object.keys(data).length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">এই সময়ে কোনো ডেটা নেই। (No data in this period.)</p>
          ) : (
            <ul className="mt-2 text-sm">{Object.entries(data).map(([k, v]) => <li key={k}>{k}: {v.orders} orders — {formatBdt(v.revenuePoisha)}</li>)}</ul>
          )}
        </section>
      ))}
      <p className="mt-4 text-xs text-slate-500">ডাটাবেস থেকে হিসাব করা — API: GET /api/v1/admin/reports?from=&amp;to=&amp;compare=1, CSV: GET /api/v1/admin/reports/export?from=&amp;to=&amp;reason= (RBAC reports.export, কারণ আবশ্যক — CSV-তে watermark থাকে ও audit-লগ হয়)।</p>
    </main>
  );
}
