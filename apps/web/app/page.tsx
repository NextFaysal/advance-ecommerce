import type { Metadata } from "next";
import Link from "next/link";
import { ProductCard } from "@/catalog/ProductCard";
import { listActivePublicProducts, listCategories } from "@/catalog/server-read";

// NOTE on route groups: Next.js forbids both app/page.tsx and app/(store)/page.tsx
// (both map to "/"). So the storefront home lives HERE, and only shop/product/search
// live under app/(store)/. This file is the Step 11 home skeleton.
// Data: real catalog DB via src/catalog/server-read (ACTIVE products +
// live categories). An empty DB renders honest empty states — no mock data.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Advance Ecommerce — বাংলাদেশের অনলাইন শপ",
  description: "ফ্যাশন, ইলেকট্রনিক্স ও আরও অনেক কিছু — সারাদেশে হোম ডেলিভারি, ক্যাশ অন ডেলিভারি।",
  openGraph: {
    title: "Advance Ecommerce",
    description: "বাংলাদেশের অনলাইন শপ — হোম ডেলিভারি, COD।",
    type: "website",
  },
};

export default async function Home() {
  const [products, categories] = await Promise.all([
    listActivePublicProducts(8),
    listCategories(),
  ]);
  return (
    <main className="mx-auto min-w-0 max-w-7xl px-4 py-6">
      {/* Hero — gradient only here, per design spec */}
      <section className="rounded-2xl bg-gradient-to-br from-[#6366F1] via-[#8B5CF6] to-[#EC4899] p-6 text-white">
        <h1 className="break-words text-2xl font-bold leading-8 [overflow-wrap:anywhere]">
          সারাদেশে হোম ডেলিভারি
        </h1>
        <p className="mt-2 break-words leading-6 [overflow-wrap:anywhere]">
          ক্যাশ অন ডেলিভারি • সহজ রিটার্ন • বাংলায় অর্ডার
        </p>
        <Link href="/shop" className="mt-4 inline-block rounded-lg bg-white px-4 py-2 text-sm font-bold text-[#4F46E5]">
          কেনাকাটা শুরু করুন
        </Link>
      </section>

      {/* Categories */}
      <section className="mt-8">
        <h2 className="text-lg font-bold">ক্যাটাগরি</h2>
        {categories.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">এখনো কোনো ক্যাটাগরি যোগ হয়নি।</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {categories.map((c) => (
              <Link key={c.slug} href={`/shop?category=${c.slug}`} className="rounded-full border border-[#E6E8F2] px-4 py-2 text-sm">
                {c.name.bn} ({c.productCount})
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Featured products */}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">জনপ্রিয় পণ্য</h2>
          <Link href="/shop" className="text-sm font-semibold text-[#4F46E5]">সব দেখুন →</Link>
        </div>
        {products.length === 0 ? (
          <div className="mt-3 rounded-xl border p-6 text-center">
            <p className="break-words leading-6">এখনো কোনো পণ্য যোগ হয়নি — শীঘ্রই আসছে।</p>
            <Link href="/shop" className="mt-3 inline-block text-sm font-semibold text-[#4F46E5]">দোকান দেখুন</Link>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
