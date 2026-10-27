"use client";

// Wave 52: the query-driven half of /search, moved client-side for
// the ISR conversion (same pattern as ShopBrowser in wave 47). Reads
// ?q= via useSearchParams and fetches the edge-cached public
// products API, which is backed by the same search service the old
// server page called directly (Meilisearch-first, honest Postgres
// fallback, PUBLIC product shape — cost stripped inside the
// service). Results are capped at the first 100 matches, exactly as
// the server page fetched them (page 1, pageSize 100).
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ThemedProductCard } from "@/themes/themed-product-card";
import type { PublicProduct } from "@/catalog/types";
import { interpolate, pick } from "@/i18n/locale";
import { useLocale } from "@/i18n/LocaleProvider";
import { STORE_STRINGS } from "../store-strings";

/** One Banglish mapping the server applied (wave 57B, meta.banglish). */
interface BanglishMapped {
  from: string;
  to: string;
}

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; products: PublicProduct[]; engine: "meilisearch" | "postgres"; mapped: BanglishMapped[] }
  | { status: "error" };

async function fetchSearchPage(
  q: string,
): Promise<{ products: PublicProduct[]; engine: "meilisearch" | "postgres"; mapped: BanglishMapped[] }> {
  const query = new URLSearchParams({ q, page: "1", pageSize: "100" });
  const res = await fetch(`/api/v1/public/products?${query}`);
  if (!res.ok) throw new Error(`GET products -> ${res.status}`);
  const json: unknown = await res.json();
  const data = (json as { data?: unknown }).data;
  const products = Array.isArray(data) ? (data as PublicProduct[]) : [];
  const meta = (json as { meta?: { engine?: unknown; banglish?: { mapped?: unknown } } }).meta;
  const engineRaw = meta?.engine;
  // The Banglish hint shows the mappings the SERVER actually applied
  // (meta.banglish from the search service), not a client-side guess:
  // exactly the canonical tokens that were appended to the query.
  const mappedRaw = meta?.banglish?.mapped;
  const mapped: BanglishMapped[] = Array.isArray(mappedRaw)
    ? mappedRaw.filter(
        (m): m is BanglishMapped =>
          typeof m === "object" && m !== null &&
          typeof (m as { from?: unknown }).from === "string" &&
          typeof (m as { to?: unknown }).to === "string",
      )
    : [];
  // The old server page distinguished only Meilisearch vs the
  // Postgres fallback — anything that is not Meilisearch is shown as
  // the fallback, never dressed up as the real engine.
  return { products, engine: engineRaw === "meilisearch" ? "meilisearch" : "postgres", mapped };
}

export function SearchBrowser() {
  const { locale, t } = useLocale();
  const s = pick(locale, STORE_STRINGS);
  const searchParams = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const [state, setState] = useState<SearchState>({ status: "idle" });

  useEffect(() => {
    if (!q) {
      setState({ status: "idle" });
      return;
    }
    let active = true;
    setState({ status: "loading" });
    fetchSearchPage(q)
      .then((result) => {
        if (active) setState({ status: "done", ...result });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [q]);

  const mapped = state.status === "done" ? state.mapped : [];
  const products = state.status === "done" ? state.products : [];

  return (
    <main className="mx-auto min-w-0 max-w-7xl px-4 py-6">
      <h1 className="break-words text-xl font-bold [overflow-wrap:anywhere]">
        {q ? interpolate(s.searchResultsFor, { q }) : s.searchHeadingDefault}
      </h1>

      {/* Search form — GET so results are shareable */}
      <form action="/search" method="get" className="mt-4 flex gap-2">
        <input
          key={q}
          name="q"
          defaultValue={q}
          placeholder={s.searchPlaceholder}
          className="min-w-0 flex-1 rounded-lg border border-[#E6E8F2] px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-lg bg-[#4F46E5] px-4 py-2 text-sm font-semibold text-white">
          {t.search}
        </button>
      </form>

      {mapped.length > 0 && (
        <p className="mt-3 text-sm text-slate-500">
          {s.searchMappedPrefix} {mapped.map((m) => interpolate(s.searchMappedItem, { to: m.to, from: m.from })).join(", ")}
        </p>
      )}

      {!q && <p className="mt-6 text-sm text-slate-500">{s.searchIdleHint}</p>}

      {q && state.status === "loading" && (
        <p className="mt-6 text-sm text-slate-500">{s.searchLoading}</p>
      )}

      {q && state.status === "error" && (
        <div className="mt-6 rounded-xl border p-6 text-center">
          <p>{s.searchErrorPrefix} <Link href="/shop" className="font-semibold text-[#4F46E5]">{t.allProducts}</Link> {s.searchErrorSuffix}</p>
        </div>
      )}

      {q && state.status === "done" && products.length === 0 && (
        <div className="mt-6 rounded-xl border p-6 text-center">
          <p>{interpolate(s.searchNoResultsPrefix, { q })} <Link href="/shop" className="font-semibold text-[#4F46E5]">{t.allProducts}</Link> {s.searchNoResultsSuffix}</p>
        </div>
      )}

      {products.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => (
            <ThemedProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
      <p className="mt-6 text-xs text-slate-500">
        {state.status === "done"
          ? state.engine === "meilisearch"
            ? s.engineMeilisearch
            : s.enginePostgres
          : s.engineDefault}
      </p>
    </main>
  );
}
