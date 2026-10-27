import { formatBdt } from "@advance-ecommerce/validators";
import { aggregateSales } from "@/reports/service";
import { daysAgoInDhaka, fetchSalesRows, todayInDhaka, withComparisonWindow } from "@/reports/db-rows";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import { ReportSchedulesPanel } from "./schedules-panel";
import { REPORTS_STRINGS } from "./strings";

// Admin reports — Step 28. Real DB rows (Prisma orders/order items,
// Asia/Dhaka dates), aggregated with the pure reports service (integer
// poisha). RBAC reports.view applies to the API; CSV via
// /api/v1/admin/reports/export.
export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, REPORTS_STRINGS);
  const range = { from: daysAgoInDhaka(29), to: todayInDhaka() };
  const rows = await fetchSalesRows(withComparisonWindow(range));
  const bundle = aggregateSales(rows, range, true);
  const t = bundle.totals;
  const sections: [string, Record<string, { orders: number; revenuePoisha: number }>][] = [
    [s.sectionDistrict, bundle.byDistrict],
    [s.sectionCourier, bundle.byCourier],
    [s.sectionProduct, bundle.byProduct],
  ];
  return (
    <main className="min-w-0">
      <h1 className="text-xl font-bold">{s.title}</h1>
      <p className="mt-2 text-sm">{interpolate(s.rangeLine, { from: range.from, to: range.to })}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border p-3"><div className="text-xs">{s.orders}</div><div className="text-lg font-bold">{t.orders}</div></div>
        <div className="rounded-xl border p-3"><div className="text-xs">{s.revenue}</div><div className="text-lg font-bold">{formatBdt(t.revenuePoisha)}</div></div>
        <div className="rounded-xl border p-3"><div className="text-xs">{s.cost}</div><div className="text-lg font-bold">{formatBdt(t.costPoisha)}</div></div>
        <div className="rounded-xl border p-3"><div className="text-xs">{s.grossProfit}</div><div className="text-lg font-bold">{formatBdt(t.grossProfitPoisha)}</div></div>
      </div>
      {bundle.comparison && (
        <p className="mt-3 text-sm">
          {interpolate(s.prevRevenueLine, {
            revenue: formatBdt(bundle.comparison.previous.revenuePoisha),
            delta: bundle.comparison.revenueDeltaPercent === null ? "—" : `${bundle.comparison.revenueDeltaPercent}%`,
          })}
        </p>
      )}
      {sections.map(([title, data]) => (
        <section key={title} className="mt-6">
          <h2 className="font-semibold">{title}</h2>
          {Object.keys(data).length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">{s.noData}</p>
          ) : (
            <ul className="mt-2 text-sm">{Object.entries(data).map(([k, v]) => <li key={k}>{k}: {interpolate(s.ordersLine, { count: v.orders, revenue: formatBdt(v.revenuePoisha) })}</li>)}</ul>
          )}
        </section>
      ))}
      <p className="mt-4 text-xs text-slate-500">{s.apiNote}</p>
      <p className="mt-3 text-sm">
        <a href="/admin/reports/builder" className="font-medium underline">{s.builderLink}</a>
        <span className="text-slate-500">{s.builderLinkDesc}</span>
      </p>
      <ReportSchedulesPanel />
    </main>
  );
}
