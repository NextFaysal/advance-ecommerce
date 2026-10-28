import { DataTableSkeleton } from "@/components/ui/table";

/**
 * Call-center route loading state (admin perf wave C1) — mirrors the
 * workbench page: title, tab strip, intro lines, the workbench block
 * and the all-tasks table (7 columns), in the page's own
 * <main className="p-6">. Presentational only — v4 skeleton
 * language, no strings or data.
 */
export default function CallCenterLoading() {
  return (
    <main className="p-6" aria-hidden="true">
      <div className="skeleton-shimmer h-7 w-64 max-w-full rounded-md" />

      {/* Tab strip */}
      <div className="mt-4 flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer h-9 w-28 rounded-xl" />
        ))}
      </div>

      <div className="skeleton-shimmer mb-4 mt-4 h-4 w-full max-w-2xl rounded-md" />
      <div className="skeleton-shimmer mb-4 h-4 w-2/3 max-w-2xl rounded-md" />

      {/* Workbench block */}
      <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="skeleton-shimmer h-11 w-11 shrink-0 rounded-full" />
          <div className="flex-1">
            <div className="skeleton-shimmer h-4 w-1/3 rounded-md" />
            <div className="skeleton-shimmer mt-2 h-3 w-1/4 rounded-md" />
          </div>
        </div>
        <div className="skeleton-shimmer mt-4 h-4 w-full rounded-md" />
        <div className="skeleton-shimmer mt-2 h-4 w-3/4 rounded-md" />
        <div className="mt-4 flex flex-wrap gap-2">
          <div className="skeleton-shimmer h-10 w-28 rounded-xl" />
          <div className="skeleton-shimmer h-10 w-28 rounded-xl" />
        </div>
      </div>

      {/* All-tasks table */}
      <div className="skeleton-shimmer mb-3 mt-8 h-5 w-40 rounded-md" />
      <DataTableSkeleton columns={7} rows={5} />
    </main>
  );
}
