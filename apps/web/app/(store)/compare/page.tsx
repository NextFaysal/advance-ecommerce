"use client";

/**
 * /compare — product comparison page. Agent 21.
 * Selection is the browser-local compare list (max 3) synced via
 * src/storefront-ux/components/CompareTray.tsx; the table itself is
 * built by the pure buildComparison() (src/storefront-ux/compare.ts),
 * which flags rows whose values differ. Products resolve from the real
 * public products API (ACTIVE-only) via src/catalog/public-client.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBdt } from "@advance-ecommerce/validators";
import { fetchPublicProducts } from "@/catalog/public-client";
import type { PublicProduct } from "@/catalog/types";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useDigitText } from "@/components/ui/numerals";
import { buildComparison } from "@/storefront-ux/compare";
import { useCompareIds } from "@/storefront-ux/components/CompareTray";
import { pick } from "@/i18n/locale";
import { useLocale } from "@/i18n/LocaleProvider";
import { STORE_STRINGS } from "../store-strings";

export default function ComparePage() {
  const digits = useDigitText();
  const { locale } = useLocale();
  const s = pick(locale, STORE_STRINGS);
  const { ids, setIds } = useCompareIds();
  const [loaded, setLoaded] = useState(false);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [catalog, setCatalog] = useState<PublicProduct[]>([]);

  useEffect(() => {
    // useCompareIds syncs the ids on mount; this just gates the empty state.
    setLoaded(true);
    let cancelled = false;
    void fetchPublicProducts().then((all) => {
      if (!cancelled) {
        setCatalog(all);
        setCatalogLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const products: PublicProduct[] = ids
    .map((id) => catalog.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  const table = buildComparison(products, locale);

  function remove(productId: string) {
    setIds(ids.filter((id) => id !== productId));
  }

  // Wave P5 (doc 32): while the catalog is still resolving the
  // compare ids, show a table skeleton — never the empty state.
  const resolving = ids.length > 0 && !catalogLoaded;
  const showEmpty = loaded && !resolving && products.length === 0;

  return (
    <main className="mx-auto min-w-0 max-w-7xl px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight">{s.compareHeading}</h1>
      <p className="mt-1 text-sm text-text-subtle">{s.compareNote}</p>

      {resolving ? (
        <div className="mt-4">
          <SkeletonTable rows={6} />
        </div>
      ) : null}

      {showEmpty ? (
        <div className="mt-6">
          <EmptyState
            title={s.compareEmptyTitle}
            description={s.compareEmptyDescription}
          >
            <Link
              href="/shop"
              className="brand-gradient mt-5 inline-flex min-h-11 items-center rounded-xl px-5 text-sm font-semibold text-white shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2"
            >
              {s.startShopping}
            </Link>
          </EmptyState>
        </div>
      ) : null}

      {products.length > 0 ? (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-border/60 bg-card shadow-xs">
          {/* Phone pattern: the feature column is sticky (opaque,
              cell-level backgrounds) so labels stay visible while
              product columns scroll horizontally under it. */}
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-border/60">
                <th className="sticky left-0 z-20 min-w-28 border-r border-border/60 bg-bg-app px-3 py-3 font-semibold">
                  {s.featureColumn}
                </th>
                {products.map((p) => (
                  <th key={p.id} className="min-w-36 bg-bg-app px-3 py-2 align-top">
                    <Link
                      href={`/product/${p.slug}`}
                      className="inline-flex min-h-11 items-center break-words rounded-lg font-semibold text-brand-ink [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                    >
                      {p.title[locale] || p.title.bn}
                    </Link>
                    <button
                      type="button"
                      onClick={() => remove(p.id)}
                      className="-ml-2 inline-flex min-h-11 items-center rounded-lg px-2 text-xs font-medium text-danger transition-colors duration-base hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                    >
                      {s.removeShort}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows
                .filter((r) => r.key !== "title")
                .map((r) => {
                  const cellBg = r.differing ? "bg-warning-soft" : "bg-card";
                  return (
                    <tr key={r.key} className="border-b border-border/60 last:border-0">
                      <th
                        className={`sticky left-0 z-10 min-w-28 border-r border-border/60 px-3 py-2.5 font-medium text-text-muted ${cellBg}`}
                      >
                        {locale === "bn" ? r.labelBn : r.labelEn}
                        {r.differing ? (
                          <span className="mt-1 block w-fit rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning-solid ring-1 ring-inset ring-warning-solid/30">
                            {s.differingBadge}
                          </span>
                        ) : null}
                      </th>
                      {r.values.map((v, i) => (
                        <td key={`${r.key}-${i}`} className={`px-3 py-2.5 tabular-nums ${cellBg}`}>
                          {v === null ? "—" : r.key === "price" ? digits(formatBdt(Number(v))) : v}
                        </td>
                      ))}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
