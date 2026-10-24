"use client";

/**
 * Recently-viewed rail — Part B wiring (Agent 21).
 * Browser-local list (localStorage); product details for quick view
 * resolve from TEMPORARY MOCK catalog data, same as the wishlist page.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBdt } from "@advance-ecommerce/validators";
import { MOCK_PRODUCTS } from "@/catalog/mock";
import { toPublicProduct } from "@/catalog/types";
import { getRecentlyViewed } from "../recently-viewed";
import { buildQuickViewData } from "../quick-view";
import type { QuickViewData, RecentlyViewedEntry } from "../types";
import { QuickViewModal } from "./QuickViewModal";

export function RecentlyViewedRail({ excludeProductId }: { excludeProductId?: string }) {
  const [entries, setEntries] = useState<RecentlyViewedEntry[]>([]);
  const [quickView, setQuickView] = useState<QuickViewData | null>(null);

  useEffect(() => {
    setEntries(getRecentlyViewed().filter((e) => e.productId !== excludeProductId));
  }, [excludeProductId]);

  if (entries.length === 0) return null;

  function openQuickView(entry: RecentlyViewedEntry) {
    const raw = MOCK_PRODUCTS.find((p) => p.id === entry.productId);
    if (raw) setQuickView(buildQuickViewData(toPublicProduct(raw)));
  }

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">সম্প্রতি দেখেছেন</h2>
        <Link href="/recently-viewed" className="text-sm font-medium text-[#4F46E5]">
          সব দেখুন →
        </Link>
      </div>
      <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
        {entries.map((e) => (
          <article key={e.productId} className="w-40 shrink-0 rounded-xl border bg-white p-3 shadow-sm">
            <Link href={`/product/${e.slug}`} className="block">
              <div className="flex h-24 items-center justify-center rounded-lg bg-[#F8F9FD] px-2 text-center text-xs text-slate-500">
                {e.titleBn}
              </div>
              <h3 className="mt-2 truncate text-sm font-medium">{e.titleBn}</h3>
              <p className="mt-1 text-sm font-bold text-[#4F46E5]">{formatBdt(e.pricePoisha)} থেকে</p>
            </Link>
            <button
              type="button"
              onClick={() => openQuickView(e)}
              className="mt-2 w-full rounded-lg border px-3 py-2 text-xs font-medium"
            >
              দ্রুত দেখুন
            </button>
          </article>
        ))}
      </div>
      <QuickViewModal data={quickView} onClose={() => setQuickView(null)} />
    </section>
  );
}
