import { SkeletonCard } from "@/components/ui/skeleton";

/**
 * Dashboard route loading state (admin perf wave C1) — mirrors the
 * dashboard's own geometry (doc 31 bento, doc 35 order): gradient
 * hero block, the pending-actions card, the 4-up KPI row, the
 * revenue/donut bento row and the recent-orders / side-stack row, in
 * the same <main> the page renders, so nothing shifts when the real
 * data lands. Presentational only — shimmer blocks in the v4
 * skeleton language, no strings or data.
 */
export default function DashboardLoading() {
  return (
    <main aria-hidden="true">
      {/* Hero band */}
      <div className="skeleton-shimmer mb-6 h-48 rounded-3xl sm:h-52" />

      {/* Pending-actions skeleton (doc 35 wave 3): mirrors the to-do
          card that now renders directly under the hero — a header
          strip plus three action rows with count chips. */}
      <div className="mb-6 rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-6" aria-hidden="true">
        <div className="skeleton-shimmer h-5 w-44 rounded-md" />
        <div className="mt-2 skeleton-shimmer h-3.5 w-64 max-w-full rounded-md" />
        <ul className="mt-4 divide-y divide-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 py-3">
              <span className="skeleton-shimmer h-5 w-8 shrink-0 rounded-full" />
              <span className="skeleton-shimmer h-4 w-40 max-w-full rounded-md" />
              <span className="ml-auto skeleton-shimmer h-4 w-4 shrink-0 rounded" />
            </li>
          ))}
        </ul>
      </div>

      {/* KPI row */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      {/* Bento row 1 — revenue chart + status donut */}
      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs xl:col-span-2">
          <div className="skeleton-shimmer h-5 w-40 rounded-md" />
          <div className="skeleton-shimmer mt-2 h-3 w-64 max-w-full rounded-md" />
          <div className="skeleton-shimmer mt-4 h-[220px] w-full rounded-md" />
          <div className="mt-6 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <div className="skeleton-shimmer h-3 w-16 rounded-md" />
                <div className="skeleton-shimmer mt-1.5 h-4 w-20 rounded-md" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
          <div className="skeleton-shimmer h-5 w-36 rounded-md" />
          <div className="skeleton-shimmer mt-2 h-3 w-48 max-w-full rounded-md" />
          <div className="skeleton-shimmer mx-auto mt-5 h-[168px] w-[168px] rounded-full" />
          <div className="mt-4 space-y-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton-shimmer h-4 w-full rounded-md" />
            ))}
          </div>
        </div>
      </div>

      {/* Bento row 2 — recent orders + side stack */}
      <div className="mb-8 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs xl:col-span-2">
          <div className="skeleton-shimmer h-5 w-40 rounded-md" />
          <div className="skeleton-shimmer mt-2 h-3 w-64 max-w-full rounded-md" />
          <div className="mt-2 divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <div className="skeleton-shimmer h-10 w-10 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <div className="skeleton-shimmer h-4 w-1/3 rounded-md" />
                  <div className="skeleton-shimmer mt-1.5 h-3 w-1/2 rounded-md" />
                </div>
                <div className="skeleton-shimmer h-6 w-16 shrink-0 rounded-full" />
                <div className="skeleton-shimmer h-4 w-16 shrink-0 rounded-md" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </main>
  );
}
