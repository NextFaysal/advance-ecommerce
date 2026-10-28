import { formatBdt } from "@advance-ecommerce/validators";
import { aggregateSales } from "@/reports/service";
import { daysAgoInDhaka, fetchSalesRows, todayInDhaka, withComparisonWindow } from "@/reports/db-rows";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader
        title={s.title}
        description={interpolate(s.rangeLine, { from: range.from, to: range.to })}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <div className="text-xs text-text-muted">{s.orders}</div>
          <div className="tnum mt-1 text-lg font-bold text-text-main">{t.orders}</div>
        </Card>
        <Card>
          <div className="text-xs text-text-muted">{s.revenue}</div>
          <div className="tnum mt-1 text-lg font-bold text-text-main">{formatBdt(t.revenuePoisha)}</div>
        </Card>
        <Card>
          <div className="text-xs text-text-muted">{s.cost}</div>
          <div className="tnum mt-1 text-lg font-bold text-text-main">{formatBdt(t.costPoisha)}</div>
        </Card>
        <Card>
          <div className="text-xs text-text-muted">{s.grossProfit}</div>
          <div className="tnum mt-1 text-lg font-bold text-text-main">{formatBdt(t.grossProfitPoisha)}</div>
        </Card>
      </div>
      {bundle.comparison && (
        <p className="tnum mt-4 text-sm text-text-muted">
          {interpolate(s.prevRevenueLine, {
            revenue: formatBdt(bundle.comparison.previous.revenuePoisha),
            delta: bundle.comparison.revenueDeltaPercent === null ? "—" : `${bundle.comparison.revenueDeltaPercent}%`,
          })}
        </p>
      )}
      <div className="mt-6 space-y-6">
        {sections.map(([title, data]) => (
          <Card key={title}>
            <h2 className="font-display text-base font-semibold text-text-main">{title}</h2>
            {Object.keys(data).length === 0 ? (
              <p className="mt-2 text-sm text-text-muted">{s.noData}</p>
            ) : (
              <ul className="mt-2 divide-y divide-border/60 text-sm">
                {Object.entries(data).map(([k, v]) => (
                  <li key={k} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span className="text-text-main">{k}:</span>
                    <span className="tnum text-text-muted">{interpolate(s.ordersLine, { count: v.orders, revenue: formatBdt(v.revenuePoisha) })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
      <p className="mt-6 text-xs leading-relaxed text-text-muted">{s.apiNote}</p>
      <p className="mt-3 text-sm">
        <a href="/admin/reports/builder" className="font-medium text-brand-ink underline">{s.builderLink}</a>
        <span className="text-text-muted">{s.builderLinkDesc}</span>
      </p>
      <ReportSchedulesPanel />
    </main>
  );
}
