"use client";

/**
 * /wishlist — customer wishlist page. Agent 19.
 * Uses the existing localStorage wishlist (src/catalog/wishlist.ts):
 * ids load on mount, removing an item re-renders from the same store.
 * Product details resolve from TEMPORARY MOCK catalog data until the
 * public products API/DB swap lands (labelled on the page).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBdt } from "@advance-ecommerce/validators";
import { getWishlistIds, toggleWishlistId } from "@/catalog/wishlist";
import { MOCK_PRODUCTS } from "@/catalog/mock";
import { toPublicProduct, type PublicProduct } from "@/catalog/types";
import { publicPriceRangePoisha } from "@/storefront-ux/quick-view";

export default function WishlistPage() {
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const ids = new Set(getWishlistIds());
    setProducts(MOCK_PRODUCTS.filter((p) => ids.has(p.id)).map(toPublicProduct));
    setLoaded(true);
  }, []);

  function remove(productId: string) {
    toggleWishlistId(productId);
    setProducts((prev) => prev.filter((p) => p.id !== productId));
  }

  return (
    <main className="mx-auto min-w-0 max-w-7xl px-4 py-6">
      <h1 className="text-xl font-bold">আমার পছন্দের তালিকা</h1>
      <p className="mt-1 text-xs text-slate-400">TEMPORARY — mock catalog data, wishlist is saved in this browser only.</p>

      {loaded && products.length === 0 && (
        <div className="mt-8 rounded-xl border bg-slate-50 px-4 py-10 text-center">
          <p className="font-medium">আপনার পছন্দের তালিকা খালি</p>
          <p className="mt-1 text-sm text-slate-500">পছন্দের পণ্যে হার্ট চিহ্ন চাপলেই এখানে যোগ হবে।</p>
          <Link href="/shop" className="mt-4 inline-block rounded-lg bg-[#4F46E5] px-4 py-2 font-semibold text-white">
            কেনাকাটা শুরু করুন
          </Link>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {products.map((p) => (
          <article key={p.id} className="rounded-xl border bg-white p-3 shadow-sm">
            <Link href={`/product/${p.slug}`} className="block">
              <div className="flex h-32 items-center justify-center rounded-lg bg-[#F8F9FD] text-sm text-slate-500">
                {p.title.bn}
              </div>
              <h2 className="mt-2 break-words font-medium [overflow-wrap:anywhere]">{p.title.bn}</h2>
              <p className="mt-1 font-bold text-[#4F46E5]">{formatBdt(publicPriceRangePoisha(p).min)} থেকে</p>
            </Link>
            <button
              type="button"
              onClick={() => remove(p.id)}
              className="mt-2 w-full rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600"
            >
              তালিকা থেকে সরান
            </button>
          </article>
        ))}
      </div>
    </main>
  );
}
