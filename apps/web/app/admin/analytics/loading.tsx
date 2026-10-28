/**
 * Analytics route loading state (admin perf wave C1) — PageHeader
 * lines, the 4-up KPI strip and section cards, in the page's own
 * <main className="min-w-0">. Presentational only — shimmer blocks
 * in the v4 skeleton language, no strings or data.
 */
export default function AnalyticsLoading() {
  return (
    <main className="min-w-0" aria-hidden="true">
      <header className="mb-6">
        <div className="skeleton-shimmer h-7 w-48 max-w-full rounded-md" />
        <div className="skeleton-shimmer mt-2 h-4 w-80 max-w-full rounded-md" />
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
            <div className="skeleton-shimmer h-3 w-20 rounded-md" />
            <div className="skeleton-shimmer mt-2 h-6 w-24 rounded-md" />
          </div>
        ))}
      </div>

      {/* Chart + breakdown sections */}
      <div className="mt-6 space-y-6">
        <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
          <div className="skeleton-shimmer h-5 w-44 rounded-md" />
          <div className="skeleton-shimmer mt-4 h-[220px] w-full rounded-xl" />
        </div>
        <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
          <div className="skeleton-shimmer h-5 w-40 rounded-md" />
          <div className="mt-2 divide-y divide-border/60">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-baseline justify-between gap-2 py-2">
                <div className="skeleton-shimmer h-4 w-1/4 rounded-md" />
                <div className="skeleton-shimmer h-4 w-1/3 rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
