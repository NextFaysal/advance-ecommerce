"use client";

/**
 * /wishlist — customer wishlist page. Agent 19.
 * Uses the existing localStorage wishlist (src/catalog/wishlist.ts):
 * ids load on mount, removing an item re-renders from the same store.
 * Product details resolve from the real public products API
 * (ACTIVE-only, cost stripped) via src/catalog/public-client — an id
 * whose product is no longer ACTIVE simply drops off the list.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBdt } from "@advance-ecommerce/validators";
import { getWishlistIds, toggleWishlistId } from "@/catalog/wishlist";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useDigitText } from "@/components/ui/numerals";
import { fetchPublicProducts } from "@/catalog/public-client";
import type { PublicProduct } from "@/catalog/types";
import { publicPriceRangePoisha } from "@/storefront-ux/quick-view";
import { interpolate, pick } from "@/i18n/locale";
import { useLocale } from "@/i18n/LocaleProvider";
import { STORE_STRINGS } from "../store-strings";

export default function WishlistPage() {
  const digits = useDigitText();
  const { locale } = useLocale();
  const s = pick(locale, STORE_STRINGS);
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ids = new Set(getWishlistIds());
    void fetchPublicProducts().then((all) => {
      if (cancelled) return;
      setProducts(all.filter((p) => ids.has(p.id)));
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function remove(productId: string) {
    toggleWishlistId(productId);
    setProducts((prev) => prev.filter((p) => p.id !== productId));
  }

  return (
    <main className="mx-auto min-w-0 max-w-7xl px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight">{s.wishlistHeading}</h1>
      <p className="mt-1 text-sm text-text-subtle">{s.wishlistNote}</p>

      {!loaded && (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/60 bg-card p-3 shadow-xs">
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="mt-2 h-4 w-4/5" />
              <Skeleton className="mt-2 h-4 w-2/5" />
              <Skeleton className="mt-2 h-11 w-full rounded-xl" />
            </div>
          ))}
        </div>
      )}

      {loaded && products.length === 0 && (
        <div className="mt-6">
          <EmptyState title={s.wishlistEmptyTitle} description={s.wishlistEmptyDescription}>
            <Link
              href="/shop"
              className="brand-gradient mt-5 inline-flex min-h-11 items-center rounded-xl px-5 text-sm font-semibold text-white shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2"
            >
              {s.startShopping}
            </Link>
          </EmptyState>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {products.map((p) => (
          <article key={p.id} className="rounded-2xl border border-border/60 bg-card p-3 shadow-xs">
            <Link
              href={`/product/${p.slug}`}
              className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              <div className="flex h-32 items-center justify-center rounded-xl bg-surface-2 px-2 text-center text-sm text-text-muted">
                {p.title[locale] || p.title.bn}
              </div>
              <h2 className="mt-2 break-words font-medium [overflow-wrap:anywhere]">{p.title[locale] || p.title.bn}</h2>
              <p className="mt-1 font-bold text-brand-ink">{interpolate(s.priceFrom, { price: digits(formatBdt(publicPriceRangePoisha(p).min)) })}</p>
            </Link>
            <button
              type="button"
              onClick={() => remove(p.id)}
              className="mt-2 min-h-11 w-full rounded-xl border border-danger/40 px-3 text-sm font-medium text-danger transition-colors duration-base hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              {s.removeFromList}
            </button>
          </article>
        ))}
      </div>
    </main>
  );
}
