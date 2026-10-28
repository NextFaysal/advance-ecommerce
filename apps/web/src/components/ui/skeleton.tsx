"use client";

/**
 * Skeleton set (Design System v4, doc 31 D3) — shimmer sweep (see
 * .skeleton-shimmer in globals.css, driven by the ds-shimmer keyframes
 * behind the animate-shimmer token) instead of the flat pulse;
 * reduced-motion safe. The loading aria-label is locale-resolved
 * (doc 30).
 */
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { ADMIN_STRINGS } from "@/admin/strings";

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  return <div aria-hidden="true" aria-label={s.loading} className={`skeleton-shimmer rounded-md ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
      <div className="flex items-center gap-3">
        <Skeleton className="h-11 w-11 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-2 h-3 w-1/3" />
        </div>
      </div>
      <Skeleton className="mt-4 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-3/4" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-xs" aria-hidden="true">
      <Skeleton className="h-11 w-full rounded-none" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-t border-border/60 px-4 py-3">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-1/6" />
          <Skeleton className="ml-auto h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * SkeletonPage (v4, additive) — full-page placeholder in the admin
 * page rhythm: header lines, a 4-up stat row and a table block, so
 * route-level loading states match the real pages' geometry.
 */
export function SkeletonPage() {
  return (
    <div aria-hidden="true">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div className="mt-6">
        <SkeletonTable rows={6} />
      </div>
    </div>
  );
}
