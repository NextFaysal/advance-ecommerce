/**
 * BD tools route loading state (admin perf wave C1) — header lines,
 * the tab strip and a panel block, in the page's own root shape.
 * Presentational only — shimmer blocks in the v4 skeleton language,
 * no strings or data.
 */
export default function BdToolsLoading() {
  return (
    <div aria-hidden="true">
      <header className="mb-6">
        <div className="skeleton-shimmer h-7 w-52 max-w-full rounded-md" />
        <div className="skeleton-shimmer mt-2 h-4 w-96 max-w-full rounded-md" />
      </header>

      {/* Tab strip */}
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer h-9 w-28 rounded-full" />
        ))}
      </div>

      {/* Active panel */}
      <div className="mt-5 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
        <div className="skeleton-shimmer h-5 w-44 rounded-md" />
        <div className="skeleton-shimmer mt-3 h-4 w-2/3 max-w-full rounded-md" />
        <div className="skeleton-shimmer mt-4 h-28 w-full rounded-xl" />
        <div className="skeleton-shimmer mt-4 h-4 w-1/3 max-w-full rounded-md" />
      </div>
    </div>
  );
}
