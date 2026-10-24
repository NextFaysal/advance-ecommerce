import type { Metadata } from "next";
import Link from "next/link";
import { ProductCard } from "@/catalog/ProductCard";
import { expandQueryTokens } from "@/catalog/search";
import { searchPublicProductsForPage } from "@/catalog/server-read";

// Data: Meilisearch-first product search with an honest Postgres
// fallback (src/catalog/search-service.ts) over the real catalog DB
// (ACTIVE products only). The answering engine is shown on the page.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Search — Advance Ecommerce",
  description: "পণ্য খুঁজুন — বাংলা ও Banglish দুটোতেই।",
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string | string[] };
}) {
  const q = Array.isArray(searchParams.q) ? searchParams.q[0] ?? "" : searchParams.q ?? "";
  // PUBLIC shape only — costPoisha stripped inside the search service.
  const searchResult = q
    ? await searchPublicProductsForPage({ query: q, page: 1, pageSize: 100 })
    : null;
  const products = searchResult?.products ?? [];
  const expansions = q ? expandQueryTokens(q).filter((t) => t !== q.toLowerCase()) : [];

  return (
    <main className="mx-auto min-w-0 max-w-7xl px-4 py-6">
      <h1 className="break-words text-xl font-bold [overflow-wrap:anywhere]">
        {q ? `“${q}” এর ফলাফল` : "পণ্য খুঁজুন"}
      </h1>

      {/* Search form — GET so results are shareable */}
      <form action="/search" method="get" className="mt-4 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="যেমন: জামা, sharee, charger…"
          className="min-w-0 flex-1 rounded-lg border border-[#E6E8F2] px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-lg bg-[#4F46E5] px-4 py-2 text-sm font-semibold text-white">
          খুঁজুন
        </button>
      </form>

      {expansions.length > 0 && (
        <p className="mt-3 text-sm text-slate-500">
          আরও খুঁজুন: {expansions.join(", ")} (Banglish → বাংলা synonym)
        </p>
      )}

      {!q && <p className="mt-6 text-sm text-slate-500">উপরে শব্দ লিখে খুঁজুন — বাংলা বা Banglish, দুটোই চলবে।</p>}

      {q && products.length === 0 && (
        <div className="mt-6 rounded-xl border p-6 text-center">
          <p>“{q}” দিয়ে কিছু পাওয়া যায়নি। বানান দেখে আবার চেষ্টা করুন বা <Link href="/shop" className="font-semibold text-[#4F46E5]">সব পণ্য</Link> দেখুন।</p>
        </div>
      )}

      {products.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
      <p className="mt-6 text-xs text-slate-500">
        {searchResult
          ? searchResult.engine === "meilisearch"
            ? "Search engine: Meilisearch (typo-tolerant, বাংলা + Banglish synonyms)।"
            : "Search engine: PostgreSQL (fallback — Meilisearch unavailable)।"
          : "Typo-tolerant search: Meilisearch (বাংলা + Banglish synonyms), না থাকলে PostgreSQL fallback।"}
      </p>
    </main>
  );
}
