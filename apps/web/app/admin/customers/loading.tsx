import { DataTableSkeleton } from "@/components/ui/table";

/**
 * Customers route loading state (doc 31, D4) — the v4 table shell with
 * shimmer rows while the server segment loads; the page itself then
 * fetches the list client-side and shows the same skeleton in place.
 */
export default function CustomersLoading() {
  return (
    <main>
      <DataTableSkeleton columns={6} rows={5} />
    </main>
  );
}
