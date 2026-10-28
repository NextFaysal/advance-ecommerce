import { DataTableSkeleton } from "@/components/ui/table";

// Loading shell (doc 31 D4) — v4 table skeleton while the server
// list loads; presentational only, no strings or data.
export default function Loading() {
  return (
    <div className="space-y-6">
      <DataTableSkeleton columns={4} rows={6} />
    </div>
  );
}
