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
import { useDigitText } from "@/components/ui/numerals";
import { buildComparison } from "@/storefront-ux/compare";
import { useCompareIds } from "@/storefront-ux/components/CompareTray";

export default function ComparePage() {
  const digits = useDigitText();
  const { ids, setIds } = useCompareIds();
  const [loaded, setLoaded] = useState(false);
  const [catalog, setCatalog] = useState<PublicProduct[]>([]);

  useEffect(() => {
    // useCompareIds syncs the ids on mount; this just gates the empty state.
    setLoaded(true);
    let cancelled = false;
    void fetchPublicProducts().then((all) => {
      if (!cancelled) setCatalog(all);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const products: PublicProduct[] = ids
    .map((id) => catalog.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  const table = buildComparison(products);

  function remove(productId: string) {
    setIds(ids.filter((id) => id !== productId));
  }

  return (
    <main className="mx-auto min-w-0 max-w-7xl px-4 py-6">
      <h1 className="text-xl font-bold">পণ্য তুলনা</h1>
      <p className="mt-1 text-xs text-slate-400">পণ্যের তথ্য আসল ক্যাটালগ থেকে আসে; তুলনার তালিকা এই ব্রাউজারেই থাকে।</p>

      {loaded && products.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="তুলনায় কোনো পণ্য নেই"
            description="পণ্যের পেজে 'তুলনা করুন' চাপলে এখানে পাশাপাশি তুলনা দেখা যাবে (সর্বোচ্চ ৩টি)।"
          />
          <div className="mt-4 text-center">
            <Link href="/shop" className="inline-block rounded-lg bg-[#4F46E5] px-4 py-2 font-semibold text-white">
              কেনাকাটা শুরু করুন
            </Link>
          </div>
        </div>
      ) : null}

      {products.length > 0 ? (
        <div className="mt-4 overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b bg-bg-app">
                <th className="px-3 py-3 font-semibold">বৈশিষ্ট্য</th>
                {products.map((p) => (
                  <th key={p.id} className="px-3 py-3">
                    <Link href={`/product/${p.slug}`} className="font-semibold text-[#4F46E5]">
                      {p.title.bn}
                    </Link>
                    <button
                      type="button"
                      onClick={() => remove(p.id)}
                      className="ml-2 text-xs font-normal text-red-600 underline"
                    >
                      সরান
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows
                .filter((r) => r.key !== "title")
                .map((r) => (
                  <tr key={r.key} className={`border-b last:border-0 ${r.differing ? "bg-amber-50" : ""}`}>
                    <th className="px-3 py-2 font-medium text-slate-600">
                      {r.labelBn}
                      {r.differing ? (
                        <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                          পার্থক্য
                        </span>
                      ) : null}
                    </th>
                    {r.values.map((v, i) => (
                      <td key={`${r.key}-${i}`} className="px-3 py-2 tabular-nums">
                        {v === null ? "—" : r.key === "price" ? digits(formatBdt(Number(v))) : v}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
