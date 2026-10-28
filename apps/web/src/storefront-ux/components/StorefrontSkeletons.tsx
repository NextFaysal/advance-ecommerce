/**
 * Storefront skeleton set (doc 32 P1) — the loading geometry for the
 * single pages, which today show blank or stale content while data
 * resolves (only /shop owns a loading.tsx).
 *
 * Built on the kit's skeleton primitive — the `.skeleton-shimmer`
 * sweep from globals.css (ds-shimmer keyframes, token-driven, with
 * the dark variant and reduced-motion handling already in the
 * stylesheet). A local `Bone` renders that class directly instead of
 * importing the admin Skeleton component, whose loading aria-label
 * resolves from ADMIN_STRINGS; the storefront set stays free of
 * admin copy and every bone here is aria-hidden inside a labelled
 * region the caller provides. All colours ride tokens (the shimmer
 * base is `--muted`), so the set renders correctly in light themes
 * and in Aurora/Circuit dark alike.
 *
 * Server-safe (no hooks, no state): drop them into loading.tsx
 * files or Suspense fallbacks.
 */

function Bone({ className = "h-4 w-full" }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton-shimmer rounded-md ${className}`} />;
}

/* ------------------------------------------------------------------ */
/* PDP — mirrors the Aurora composition geometry (breadcrumb,        */
/* gallery | buy column grid, then full-width section cards).        */
/* ------------------------------------------------------------------ */

export function PdpSkeleton() {
  return (
    <div aria-hidden="true" className="mx-auto min-w-0 max-w-[1440px] px-4 py-6 sm:px-6 lg:py-8">
      <Bone className="h-4 w-64 max-w-full" />
      <div className="mt-5 grid items-start gap-8 lg:grid-cols-2">
        <Bone className="aspect-[4/5] w-full rounded-3xl" />
        <div className="min-w-0">
          <Bone className="h-9 w-4/5" />
          <Bone className="mt-2 h-4 w-2/5" />
          <Bone className="mt-4 h-9 w-3/5 rounded-2xl" />
          <div className="mt-5 rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
            <Bone className="h-10 w-1/2" />
            <Bone className="mt-6 h-4 w-1/3" />
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Bone className="h-9 w-24 rounded-full" />
              <Bone className="h-9 w-28 rounded-full" />
              <Bone className="h-9 w-20 rounded-full" />
            </div>
            <Bone className="mt-6 h-12 w-full rounded-xl" />
            <Bone className="mt-3 h-12 w-full rounded-xl" />
            <div className="mt-6 grid gap-2.5 border-t border-border pt-5 sm:grid-cols-2">
              <Bone className="h-16 rounded-2xl" />
              <Bone className="h-16 rounded-2xl" />
            </div>
          </div>
        </div>
      </div>
      <div className="mt-10 rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8">
        <Bone className="h-6 w-48" />
        <Bone className="mt-4 h-4 w-full" />
        <Bone className="mt-2 h-4 w-11/12" />
        <Bone className="mt-2 h-4 w-3/4" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cart rows — one row matches the drawer/page line geometry; the    */
/* list form stacks them with the same divide rhythm.                */
/* ------------------------------------------------------------------ */

export function CartRowSkeleton() {
  return (
    <div aria-hidden="true" className="flex gap-3 py-3.5">
      <Bone className="h-[64px] w-[64px] shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <Bone className="h-4 w-3/4" />
        <Bone className="mt-1.5 h-3 w-1/4" />
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <Bone className="h-9 w-[116px] rounded-md" />
          <Bone className="h-4 w-20" />
        </div>
      </div>
    </div>
  );
}

export function CartListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <CartRowSkeleton key={i} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card grid — shop/search/wishlist result grids (card preset        */
/* geometry: 4:5 image, two text lines, price line).                 */
/* ------------------------------------------------------------------ */

export function CardGridSkeleton({
  count = 8,
  className = "",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4 ${className}`}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <Bone className="aspect-[4/5] w-full rounded-none" />
          <div className="p-3">
            <Bone className="h-4 w-5/6" />
            <Bone className="mt-2 h-4 w-2/3" />
            <Bone className="mt-2.5 h-5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Account section — the hub/subpage section-card rhythm (header     */
/* line + content rows) at the account pages' reading width.         */
/* ------------------------------------------------------------------ */

export function AccountSectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <section
      aria-hidden="true"
      className="rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8"
    >
      <Bone className="h-6 w-44" />
      <div className="mt-5 space-y-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Bone className="h-11 w-11 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Bone className="h-4 w-1/2" />
              <Bone className="mt-1.5 h-3 w-1/3" />
            </div>
            <Bone className="h-8 w-20 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Convenience wrapper so a fallback can stack several sections. */
export function AccountPageSkeleton({ sections = 2 }: { sections?: number }) {
  return (
    <div aria-hidden="true" className="space-y-6">
      {Array.from({ length: sections }).map((_, i) => (
        <AccountSectionSkeleton key={i} />
      ))}
    </div>
  );
}
