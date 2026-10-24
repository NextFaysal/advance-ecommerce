"use client";

/**
 * /recently-viewed — full recently-viewed list. Agent 21.
 * Browser-local only (localStorage, src/storefront-ux/recently-viewed.ts):
 * no account, no server data. Prices are the poisha values captured at
 * view time; product links go to the live product page.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBdt } from "@advance-ecommerce/validators";
import { EmptyState } from "@/components/ui/empty-state";
import { useDigitText } from "@/components/ui/numerals";
import { clearRecentlyViewed, getRecentlyViewed } from "@/storefront-ux/recently-viewed";
import type { RecentlyViewedEntry } from "@/storefront-ux/types";

export default function RecentlyViewedPage() {
  const digits = useDigitText();
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">সম্প্রতি দেখেছেন</h1>
        {entries.length > 0 ? (
          <button type="button" onClick={clearAll} className="text-sm text-red-600 underline">
            ইতিহাস মুছুন
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-slate-400">এই তালিকা শুধু এই ব্রাউজারেই থাকে — অ্যাকাউন্টে সংরক্ষিত হয় না।</p>

      {loaded && entries.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="এখনো কিছু দেখেননি" description="পণ্যের পেজে গেলেই সেগুলো এখানে জমা হবে।" />
          <div className="mt-4 text-center">
            <Link href="/shop" className="inline-block rounded-lg bg-[#4F46E5] px-4 py-2 font-semibold text-white">
              কেনাকাটা শুরু করুন
            </Link>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {entries.map((e) => (
          <Link
            key={e.productId}
            href={`/product/${e.slug}`}
            className="block rounded-xl border bg-card p-3 shadow-sm"
          >
            <div className="flex h-32 items-center justify-center rounded-lg bg-bg-app px-2 text-center text-sm text-slate-500">
              {e.titleBn}
            </div>
            <h2 className="mt-2 break-words font-medium [overflow-wrap:anywhere]">{e.titleBn}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{e.titleEn}</p>
            <p className="mt-1 font-bold text-[#4F46E5]">{digits(formatBdt(e.pricePoisha))} থেকে</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
