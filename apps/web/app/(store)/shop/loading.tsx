import { Skeleton } from "@/components/ui/skeleton";

// Shop loading state — sidebar + card-grid skeletons so the PLP never
// flashes a blank page while the catalog query runs.
function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <Skeleton className="aspect-[4/5] w-full rounded-none" />
      <div className="space-y-2 px-3.5 py-3">
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3.5 w-3/5" />
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  );
}

export default function ShopLoading() {
  return (
    <main className="mx-auto min-w-0 max-w-[1440px] px-4 py-6 sm:px-6 lg:py-8" aria-label="লোড হচ্ছে">
      <Skeleton className="h-4 w-40" />
      <div className="mt-4 grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="hidden rounded-2xl border border-border bg-card p-4 shadow-sm lg:block">
          <Skeleton className="h-5 w-24" />
          <div className="mt-4 space-y-2.5">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
          <Skeleton className="mt-6 h-5 w-20" />
          <div className="mt-4 space-y-2.5">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </aside>
        <section className="min-w-0">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="mt-2 h-4 w-32" />
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
