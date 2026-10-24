import type { Metadata } from "next";
import Link from "next/link";
import { ProductCard } from "@/catalog/ProductCard";
import type { SortOption } from "@/catalog/search";
import { listCategories, listPublicProducts } from "@/catalog/server-read";

// Data: real catalog DB (ACTIVE products only) via the Prisma
// repository — the same filter contract as GET /api/v1/public/products.
// An empty DB renders the honest empty state below, never mock data.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shop — Advance Ecommerce",
  description: "সব পণ্য — ফিল্টার, সর্ট ও সার্চ দিয়ে খুঁজুন।",
};

// SearchParams are strings in App Router; parse defensively, never trust the client.
function parseSort(value: string | string[] | undefined): SortOption {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "price-asc" || v === "price-desc" || v === "rating" || v === "newest") return v;
  return "relevance";
}

function parsePoisha(value: string | string[] | undefined): number | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: { category?: string | string[]; brand?: string | string[]; sort?: string | string[]; min?: string | string[]; max?: string | string[]; instock?: string | string[]; q?: string | string[] };
}) {
  const category = Array.isArray(searchParams.category) ? searchParams.category[0] : searchParams.category;
  const brand = Array.isArray(searchParams.brand) ? searchParams.brand[0] : searchParams.brand;
  const q = Array.isArray(searchParams.q) ? searchParams.q[0] : searchParams.q;
  // PUBLIC shape only (listPublicProducts strips costPoisha): the full
  // repository Product must never reach ProductCard's serialized props.
  const [result, categories] = await Promise.all([
    listPublicProducts({
      query: q,
      categorySlug: category,
      brandName: brand,
      sort: parseSort(searchParams.sort),
      minPricePoisha: parsePoisha(searchParams.min),
      maxPricePoisha: parsePoisha(searchParams.max),
      inStockOnly: searchParams.instock === "1",
      page: 1,
      pageSize: 100,
    }),
    listCategories(),
  ]);
  const products = result.products;

  return (
    <main className="mx-auto min-w-0 max-w-7xl px-4 py-6">
      <h1 className="break-words text-xl font-bold [overflow-wrap:anywhere]">সব পণ্য</h1>

      {/* Filters — server-driven via query params, so links are shareable/SEO-friendly */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/shop" className="rounded-full border px-3 py-1 text-sm">সব</Link>
        {categories.map((c) => (
          <Link key={c.slug} href={`/shop?category=${c.slug}`} className="rounded-full border px-3 py-1 text-sm">
            {c.name.bn}
          </Link>
        ))}
        <Link href="/shop?instock=1" className="rounded-full border px-3 py-1 text-sm">স্টকে আছে</Link>
        <Link href="/shop?sort=price-asc" className="rounded-full border px-3 py-1 text-sm">দাম: কম → বেশি</Link>
        <Link href="/shop?sort=price-desc" className="rounded-full border px-3 py-1 text-sm">দাম: বেশি → কম</Link>
        <Link href="/shop?sort=newest" className="rounded-full border px-3 py-1 text-sm">নতুন</Link>
      </div>

      {products.length === 0 ? (
        <div className="mt-8 rounded-xl border p-6 text-center">
          <p className="break-words leading-6">কোনো পণ্য পাওয়া যায়নি। অন্য শব্দ দিয়ে আবার চেষ্টা করুন।</p>
          <Link href="/shop" className="mt-3 inline-block text-sm font-semibold text-[#4F46E5]">সব পণ্য দেখুন</Link>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </main>
  );
}
