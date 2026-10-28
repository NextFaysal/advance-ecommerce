import { Skeleton } from "@/components/ui/skeleton";

// Route-level loading state for /wishlist (wave P5, doc 32) —
// heading + card-grid skeleton in the page's own geometry.
export default function WishlistLoading() {
  return (
    <main className="mx-auto min-w-0 max-w-7xl px-4 py-6" aria-hidden="true">
      <Skeleton className="h-7 w-48 max-w-full" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/60 bg-card p-3 shadow-xs">
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="mt-2 h-4 w-4/5" />
            <Skeleton className="mt-2 h-4 w-2/5" />
            <Skeleton className="mt-2 h-11 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </main>
  );
}
