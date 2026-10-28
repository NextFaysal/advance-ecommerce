"use client";

/**
 * /recently-viewed — full recently-viewed list. Agent 21.
 * Browser-local only (localStorage, src/storefront-ux/recently-viewed.ts):
 * no account, no server data. Prices are the poisha values captured at
 * view time; product links go to the live product page.
 *
 * Wave P5 (doc 32): platform page pattern — kit EmptyState, loading
 * skeleton, token colours, 44px targets — and the copy moved into
 * the area dictionary (strings.ts): the page previously rendered
 * hardcoded Bangla in every locale. Titles follow the doc-30 PDP
 * pattern: primary title in the visitor's locale, the other
 * language as a small subtitle.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBdt } from "@advance-ecommerce/validators";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useDigitText } from "@/components/ui/numerals";
import { clearRecentlyViewed, getRecentlyViewed } from "@/storefront-ux/recently-viewed";
import type { RecentlyViewedEntry } from "@/storefront-ux/types";
import { interpolate, pick } from "@/i18n/locale";
import { useLocale } from "@/i18n/LocaleProvider";
import { RECENTLY_VIEWED_STRINGS } from "./strings";

export default function RecentlyViewedPage() {
  const digits = useDigitText();
  const { locale } = useLocale();
  const s = pick(locale, RECENTLY_VIEWED_STRINGS);
  const [entries, setEntries] = useState<RecentlyViewedEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setEntries(getRecentlyViewed());
    setLoaded(true);
  }, []);

  function clearAll() {
    clearRecentlyViewed();
    setEntries([]);
  }

  return (
    <main className="mx-auto min-w-0 max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{s.heading}</h1>
        {entries.length > 0 ? (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-danger transition-colors duration-base hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            {s.clearHistory}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-text-subtle">{s.note}</p>

      {!loaded ? (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/60 bg-card p-3 shadow-xs">
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="mt-2 h-4 w-4/5" />
              <Skeleton className="mt-2 h-3 w-3/5" />
              <Skeleton className="mt-2 h-4 w-2/5" />
            </div>
          ))}
        </div>
      ) : null}

      {loaded && entries.length === 0 ? (
        <div className="mt-6">
          <EmptyState title={s.emptyTitle} description={s.emptyDescription}>
            <Link
              href="/shop"
              className="brand-gradient mt-5 inline-flex min-h-11 items-center rounded-xl px-5 text-sm font-semibold text-white shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2"
            >
              {s.startShopping}
            </Link>
          </EmptyState>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {entries.map((e) => {
          const title = locale === "bn" ? e.titleBn : e.titleEn || e.titleBn;
          const subtitle = locale === "bn" ? e.titleEn : e.titleBn;
          return (
            <Link
              key={e.productId}
              href={`/product/${e.slug}`}
              className="block rounded-2xl border border-border/60 bg-card p-3 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              <div className="flex h-32 items-center justify-center rounded-xl bg-surface-2 px-2 text-center text-sm text-text-muted">
                {title}
              </div>
              <h2 className="mt-2 break-words font-medium [overflow-wrap:anywhere]">{title}</h2>
              {subtitle && subtitle !== title ? (
                <p className="mt-0.5 break-words text-xs text-text-subtle [overflow-wrap:anywhere]">{subtitle}</p>
              ) : null}
              <p className="mt-1 font-bold text-brand-ink">{interpolate(s.priceFrom, { price: digits(formatBdt(e.pricePoisha)) })}</p>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
