import { DataTableSkeleton } from "@/components/ui/table";

/**
 * Orders route loading state (admin perf wave C1) — PageHeader lines
 * plus the same 6-column table skeleton the page itself shows while
 * its list loads, in the page's own <main>, so the header and table
 * land without shifting. Presentational only, no strings or data.
 */
export default function OrdersLoading() {
  return (
    <main aria-hidden="true">
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="skeleton-shimmer h-7 w-56 max-w-full rounded-md" />
            <div className="skeleton-shimmer mt-2 h-4 w-96 max-w-full rounded-md" />
          </div>
          <div className="skeleton-shimmer h-10 w-24 rounded-xl" />
        </div>
      </header>
      <DataTableSkeleton columns={6} rows={5} />
    </main>
  );
}
