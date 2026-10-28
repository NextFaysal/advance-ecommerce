/**
 * Settings index route loading state (admin perf wave C1) — renders
 * inside the settings segment layout (nav rail stays put), mirroring
 * the index page: PageHeader lines, the 4-up stat row, the summary
 * card and the section-card grid, in the page's own <main>.
 * Presentational only — shimmer blocks in the v4 skeleton language,
 * no strings or data.
 */
export default function SettingsLoading() {
  return (
    <main aria-hidden="true">
      <header className="mb-6">
        <div className="skeleton-shimmer mb-1.5 h-3 w-32 max-w-full rounded-md" />
        <div className="skeleton-shimmer h-8 w-48 max-w-full rounded-md" />
        <div className="skeleton-shimmer mt-2 h-4 w-96 max-w-full rounded-md" />
      </header>

      {/* Stat row */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
            <div className="skeleton-shimmer h-3 w-20 rounded-md" />
            <div className="skeleton-shimmer mt-2 h-6 w-24 rounded-md" />
            <div className="skeleton-shimmer mt-2 h-3 w-28 max-w-full rounded-md" />
          </div>
        ))}
      </div>

      {/* Summary card */}
      <div className="mb-6 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
        <div className="skeleton-shimmer h-5 w-44 rounded-md" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <div className="skeleton-shimmer h-3 w-24 max-w-full rounded-md" />
              <div className="skeleton-shimmer mt-1.5 h-4 w-20 rounded-md" />
            </div>
          ))}
        </div>
        <div className="skeleton-shimmer mt-3 h-4 w-2/3 max-w-full rounded-md" />
      </div>

      {/* Section cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
            <div className="skeleton-shimmer h-12 w-12 rounded-[14px]" />
            <div className="skeleton-shimmer mt-3 h-5 w-1/2 rounded-md" />
            <div className="skeleton-shimmer mt-2 h-4 w-full rounded-md" />
            <div className="skeleton-shimmer mt-2 h-4 w-2/3 rounded-md" />
          </div>
        ))}
      </div>
    </main>
  );
}
