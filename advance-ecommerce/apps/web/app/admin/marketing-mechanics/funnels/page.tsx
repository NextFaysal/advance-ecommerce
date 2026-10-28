import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { formatBdt } from "@advance-ecommerce/validators";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import { funnelStore } from "@/funnels/store";
import { FUNNEL_STEP_LABELS } from "@/funnels/types";
import { landingStore } from "@/landing/store";
import { getFunnelAnalyticsReport, loadFunnelBumpOrderCounts } from "@/marketing/funnel-analytics-source";
import { MECHANICS_STRINGS } from "../strings";

// Admin > Marketing Mechanics > Funnel Analytics (doc 34 §3.8, L9).
// A server report over the funnel layer's REAL records: step views
// from TrackingEvent rows (funnel:<id>:<step>:view), orders +
// revenue from orders attributed to the funnel by their create-time
// OrderNote records, offer accepts from the accept markers — all
// aggregated by the pure src/marketing/funnel-analytics module via
// its Prisma source. Raw counts + descriptive percentages ONLY:
// no significance, no winner (the experiments honesty rule). A
// funnel with no traffic shows zeros, never invented numbers.
export const dynamic = "force-dynamic";

function pct2(numerator: number, denominator: number): string | null {
  if (denominator <= 0) return null;
  return `${Math.round((numerator / denominator) * 10000) / 100}%`;
}

export default async function FunnelAnalyticsPage({
  searchParams,
}: {
  searchParams: { funnel?: string | string[] };
}) {
  const locale = await getRequestLocale();
  const s = pick(locale, MECHANICS_STRINGS);
  const funnels = await funnelStore.list();
  const requested = typeof searchParams.funnel === "string" ? searchParams.funnel : null;
  const selected = funnels.find((f) => f.id === requested) ?? funnels[0] ?? null;

  let body: React.ReactNode;
  if (selected === null) {
    body = (
      <Card className="mt-6">
        <p className="text-sm text-text-muted">{s.faNoFunnels}</p>
      </Card>
    );
  } else {
    const [report, bumpCounts] = await Promise.all([
      getFunnelAnalyticsReport(selected.id),
      loadFunnelBumpOrderCounts(selected.id),
    ]);
    // Step page titles (merchant data — picked per locale like the
    // rest of the storefront: en title with bn fallback and back).
    const pageTitles = new Map<string, string>();
    for (const pageId of [...new Set(selected.steps.map((step) => step.pageId))]) {
      const page = await landingStore.get(pageId);
      if (page) pageTitles.set(pageId, locale === "en" ? page.titleEn || page.titleBn : page.titleBn);
    }
    const stepById = new Map(selected.steps.map((step) => [step.id, step]));
    const hasBump = (stepId: string) => {
      const step = stepById.get(stepId);
      return step !== undefined && step.kind === "order" && step.bump !== undefined;
    };

    body = (
      <>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-text-muted">{s.faPickerLabel}</span>
          {funnels.map((funnel) => (
            <Link
              key={funnel.id}
              href={`/admin/marketing-mechanics/funnels?funnel=${encodeURIComponent(funnel.id)}`}
              className={
                funnel.id === selected.id
                  ? "rounded-full bg-brand-600 px-3 py-1.5 text-xs font-bold text-white"
                  : "rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-text-main hover:bg-brand-soft"
              }
            >
              {funnel.name} <span className="opacity-70">({funnel.status})</span>
            </Link>
          ))}
        </div>

        {report.steps.length === 0 ? (
          <Card className="mt-6">
            <p className="text-sm text-text-muted">{s.faNoSteps}</p>
          </Card>
        ) : (
          <Card className="mt-6">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <p className="font-display text-base font-bold text-text-main">{selected.name}</p>
              <p className="tnum text-sm text-text-muted">
                {s.faThViews}: <strong className="text-text-main">{report.totalViews}</strong>
              </p>
              <p className="tnum text-sm text-text-muted">
                {s.faThOrders}: <strong className="text-text-main">{report.totalOrders}</strong>
              </p>
              <p className="tnum text-sm text-text-muted">
                {s.faThRevenue}: <strong className="text-text-main">{formatBdt(report.totalRevenuePoisha)}</strong>
              </p>
            </div>
            {report.totalViews === 0 && report.totalOrders === 0 ? (
              <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-sm text-text-muted">{s.faNoDataYet}</p>
            ) : null}
            <div className="mt-4">
              <DataTable
                columns={[
                  { key: "step", header: s.faThStep },
                  { key: "page", header: s.faThPage },
                  { key: "views", header: s.faThViews },
                  { key: "orders", header: s.faThOrders },
                  { key: "revenue", header: s.faThRevenue },
                  { key: "conversion", header: s.faThConversion },
                  { key: "attach", header: s.faThAttachAccept },
                ]}
                rows={report.steps.map((row) => {
                  const step = stepById.get(row.stepId);
                  const kindLabel = FUNNEL_STEP_LABELS[row.kind][locale];
                  let attach: string = "—";
                  if (row.acceptedCount !== null) {
                    // Offer step: accepts + the aggregator's accept rate.
                    attach = row.acceptRatePercent !== null ? `${row.acceptedCount} · ${row.acceptRatePercent}%` : `${row.acceptedCount}`;
                  } else if (hasBump(row.stepId)) {
                    // Order step with a bump: attach rate over its orders.
                    const bumpOrders = bumpCounts.get(row.stepId) ?? 0;
                    const rate = pct2(bumpOrders, row.orders);
                    attach = rate !== null ? `${bumpOrders} · ${rate}` : `${bumpOrders}`;
                  }
                  return {
                    step: (
                      <span>
                        <span className="font-semibold text-text-main">{kindLabel}</span>{" "}
                        <span className="font-mono text-xs text-text-subtle">{row.stepId}</span>
                      </span>
                    ),
                    page: <span className="text-text-muted">{step ? (pageTitles.get(step.pageId) ?? step.pageId) : "—"}</span>,
                    views: <span className="tnum">{row.views}</span>,
                    orders: <span className="tnum">{row.orders}</span>,
                    revenue: <span className="tnum">{formatBdt(row.revenuePoisha)}</span>,
                    conversion: <span className="tnum">{pct2(row.orders, row.views) ?? "—"}</span>,
                    attach: <span className="tnum">{attach}</span>,
                  };
                })}
              />
            </div>
            {report.orphanedViews > 0 || report.orphanedOrders > 0 ? (
              <p className="mt-3 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning-solid">
                {interpolate(s.faOrphanedNote, { views: report.orphanedViews, orders: report.orphanedOrders })}
              </p>
            ) : null}
            <p className="mt-3 text-xs text-text-muted">{s.faRawCountsNote}</p>
            <p className="mt-1 text-xs text-text-muted">{s.faRevenueBasis}</p>
          </Card>
        )}
      </>
    );
  }

  return (
    <main>
      <PageHeader title={s.faTitle} description={s.faIntro} />
      {body}
    </main>
  );
}
