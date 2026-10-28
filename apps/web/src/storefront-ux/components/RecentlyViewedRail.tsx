"use client";

/**
 * Recently-viewed rail — Part B wiring (Agent 21).
 * Browser-local list (localStorage) whose entries carry their own
 * display snapshot; quick-view details resolve fresh from the real
 * public catalog API by slug (ACTIVE-only) — no mock data.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBdt } from "@advance-ecommerce/validators";
import { fetchPublicProductBySlug } from "@/catalog/public-client";
import { useDigitText } from "@/components/ui/numerals";
import { interpolate, pick } from "@/i18n/locale";
import { useLocale } from "@/i18n/LocaleProvider";
import { getRecentlyViewed } from "../recently-viewed";
import { buildQuickViewData } from "../quick-view";
import type { QuickViewData, RecentlyViewedEntry } from "../types";
import { QuickViewModal } from "./QuickViewModal";
import { UX_STRINGS } from "../strings";

export function RecentlyViewedRail({ excludeProductId }: { excludeProductId?: string }) {
  const digits = useDigitText();
  const { locale } = useLocale();
  const s = pick(locale, UX_STRINGS);
  const [entries, setEntries] = useState<RecentlyViewedEntry[]>([]);
  const [quickView, setQuickView] = useState<QuickViewData | null>(null);

  useEffect(() => {
    setEntries(getRecentlyViewed().filter((e) => e.productId !== excludeProductId));
  }, [excludeProductId]);

  if (entries.length === 0) return null;

  async function openQuickView(entry: RecentlyViewedEntry) {
    const product = await fetchPublicProductBySlug(entry.slug);
    if (product) setQuickView(buildQuickViewData(product, locale));
  }

  // Entry titles are merchant data snapshotted with bn/en variants.
  const entryTitle = (e: RecentlyViewedEntry) => (locale === "bn" ? e.titleBn : e.titleEn);

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{s.rvTitle}</h2>
        <Link href="/recently-viewed" className="text-sm font-medium text-primary">
          {s.rvViewAll}
        </Link>
      </div>
      <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
        {entries.map((e) => (
          <article key={e.productId} className="w-40 shrink-0 rounded-xl border bg-card p-3 shadow-sm">
            <Link href={`/product/${e.slug}`} className="block">
              <div className="flex h-24 items-center justify-center rounded-lg bg-surface-2 px-2 text-center text-xs text-text-muted">
                {entryTitle(e)}
              </div>
              <h3 className="mt-2 truncate text-sm font-medium">{entryTitle(e)}</h3>
              <p className="mt-1 text-sm font-bold text-primary">{interpolate(s.priceFromTemplate, { price: digits(formatBdt(e.pricePoisha)) })}</p>
            </Link>
            <button
              type="button"
              onClick={() => openQuickView(e)}
              className="mt-2 w-full rounded-lg border px-3 py-2 text-xs font-medium"
            >
              {s.quickView}
            </button>
          </article>
        ))}
      </div>
      <QuickViewModal data={quickView} onClose={() => setQuickView(null)} />
    </section>
  );
}
