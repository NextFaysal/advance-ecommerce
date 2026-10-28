/**
 * Order detail route loading state (admin perf wave C1) — mirrors
 * the workspace geometry: back link, the header band card (order no,
 * status badges, total), then the 320px rail + tabbed main column
 * grid, in the page's own <main>. Presentational only — shimmer
 * blocks in the v4 skeleton language, no strings or data.
 */
export default function OrderDetailLoading() {
  return (
    <main aria-hidden="true">
      {/* Back link */}
      <div className="skeleton-shimmer mb-4 h-4 w-28 rounded-md" />

      {/* Header band */}
      <div className="mb-5 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="skeleton-shimmer h-8 w-64 max-w-full rounded-md" />
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <div className="skeleton-shimmer h-6 w-20 rounded-full" />
              <div className="skeleton-shimmer h-6 w-16 rounded-full" />
              <div className="skeleton-shimmer h-6 w-24 rounded-full" />
              <div className="skeleton-shimmer h-6 w-20 rounded-full" />
            </div>
            <div className="skeleton-shimmer mt-2.5 h-4 w-56 max-w-full rounded-md" />
          </div>
          <div className="shrink-0">
            <div className="skeleton-shimmer ml-auto h-3 w-16 rounded-md" />
            <div className="skeleton-shimmer ml-auto mt-1.5 h-9 w-32 rounded-md" />
            <div className="skeleton-shimmer ml-auto mt-3 h-10 w-28 rounded-xl" />
          </div>
        </div>
      </div>

      {/* Rail + main column */}
      <div className="grid items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
              <div className="skeleton-shimmer h-5 w-32 rounded-md" />
              <div className="mt-3 space-y-2.5">
                <div className="skeleton-shimmer h-4 w-full rounded-md" />
                <div className="skeleton-shimmer h-4 w-3/4 rounded-md" />
                <div className="skeleton-shimmer h-4 w-5/6 rounded-md" />
              </div>
            </div>
          ))}
        </div>
        <div className="min-w-0">
          {/* Tab strip */}
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton-shimmer h-9 w-24 rounded-xl" />
            ))}
          </div>
          <div className="mt-5 space-y-5">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
                <div className="skeleton-shimmer h-5 w-40 rounded-md" />
                <div className="mt-3 space-y-2.5">
                  <div className="skeleton-shimmer h-4 w-full rounded-md" />
                  <div className="skeleton-shimmer h-4 w-2/3 rounded-md" />
                  <div className="skeleton-shimmer h-4 w-4/5 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
