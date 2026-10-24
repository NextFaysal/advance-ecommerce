export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div aria-hidden="true" aria-label="Loading" className={`animate-pulse rounded-md bg-surface-2 ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-3/4" />
    </div>
  );
}
