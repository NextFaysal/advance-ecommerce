import { DataTableSkeleton } from "@/components/ui/table";

/**
 * Inventory route loading state (admin perf wave C1) — PageHeader
 * lines, the 3-up summary strip and the 7-column stock table, in the
 * page's own <main className="min-w-0 space-y-6"> rhythm.
 * Presentational only — v4 skeleton language, no strings or data.
 */
export default function InventoryLoading() {
  return (
    <main className="min-w-0 space-y-6" aria-hidden="true">
      <header>
        <div className="skeleton-shimmer h-7 w-56 max-w-full rounded-md" />
        <div className="skeleton-shimmer mt-2 h-4 w-96 max-w-full rounded-md" />
      </header>

      {/* Summary strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
            <div className="skeleton-shimmer h-3 w-24 rounded-md" />
            <div className="skeleton-shimmer mt-2 h-8 w-28 rounded-md" />
            <div className="skeleton-shimmer mt-2 h-3 w-36 max-w-full rounded-md" />
          </div>
        ))}
      </div>

      <DataTableSkeleton columns={7} rows={6} />
    </main>
  );
}
