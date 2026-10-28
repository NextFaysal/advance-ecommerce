import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";

// Route-level loading state for /compare (wave P5, doc 32) —
// heading + table skeleton in the page's own geometry.
export default function CompareLoading() {
  return (
    <main className="mx-auto min-w-0 max-w-7xl px-4 py-6" aria-hidden="true">
      <Skeleton className="h-7 w-48 max-w-full" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      <div className="mt-4">
        <SkeletonTable rows={6} />
      </div>
    </main>
  );
}
