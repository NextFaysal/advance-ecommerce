import { DataTableSkeleton } from "@/components/ui/table";

// Loading shell (doc 31 D4) — v4 table skeleton while the route
// loads; presentational only, no strings or data. (The panels
// themselves fetch client-side and show their own loading state.)
export default function Loading() {
  return (
    <div className="space-y-6">
      <DataTableSkeleton columns={5} rows={6} />
    </div>
  );
}
