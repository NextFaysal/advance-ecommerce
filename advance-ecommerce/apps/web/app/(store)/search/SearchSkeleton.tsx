/**
 * Search loading skeletons (wave P5, doc 32) — built on the doc-31
 * kit Skeleton primitives, mirroring the shop loading.tsx pattern:
 * the /search shell's Suspense fallback and the browser's in-flight
 * state render these instead of a blank first paint / bare text.
 * Presentational only — the kit Skeleton resolves its own aria
 * locale; card geometry mirrors the ThemedProductCard grid below.
 */
import { Skeleton } from "@/components/ui/skeleton";

function SearchCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-xs">
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="space-y-2 px-3.5 py-3">
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3.5 w-3/5" />
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  );
}

/** Results-grid skeleton (heading + form already on screen). */
export function SearchResultsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <SearchCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Full-page skeleton for the shell Suspense fallback / loading.tsx. */
export function SearchPageSkeleton() {
  return (
    <div aria-hidden="true">
      <Skeleton className="h-7 w-56 max-w-full" />
      <div className="mt-4 flex gap-2">
        <Skeleton className="min-h-11 flex-1 rounded-xl" />
        <Skeleton className="min-h-11 w-24 rounded-xl" />
      </div>
      <SearchResultsSkeleton />
    </div>
  );
}
