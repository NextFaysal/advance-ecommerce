import { DataTableSkeleton } from "@/components/ui/table";

/**
 * Products route loading state (admin perf wave C1) — PageHeader
 * lines (breadcrumb, title, subtitle, actions) plus the same
 * 5-column / 8-row table skeleton the products table itself shows
 * while its rows load, in the page's own <main className="min-w-0">.
 * Presentational only, no strings or data.
 */
export default function ProductsLoading() {
  return (
    <main className="min-w-0" aria-hidden="true">
      <header className="mb-6">
        <div className="skeleton-shimmer mb-2 h-4 w-44 max-w-full rounded-md" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="skeleton-shimmer h-7 w-56 max-w-full rounded-md" />
            <div className="skeleton-shimmer mt-2 h-4 w-96 max-w-full rounded-md" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="skeleton-shimmer h-11 w-28 rounded-xl" />
            <div className="skeleton-shimmer h-11 w-28 rounded-xl" />
            <div className="skeleton-shimmer h-11 w-32 rounded-xl" />
          </div>
        </div>
      </header>
      <DataTableSkeleton columns={5} rows={8} />
    </main>
  );
}
