import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchBrowser } from "./SearchBrowser";
import { SearchPageSkeleton } from "./SearchSkeleton";
import { pick } from "@/i18n/locale";
import { getStoreDefaultLocale } from "@/i18n/server";
import { STORE_STRINGS } from "../store-strings";

// Wave 52 (search speed): /search used to render per-request on the
// server from the ?q= searchParam (force-dynamic), while /shop —
// converted in wave 47 — serves a static shell and lets the client
// drive the same search service over the edge-cached products API.
// /search now follows that exact pattern: this shell does no data
// fetching and reads no searchParams; the client SearchBrowser owns
// the query UI and fetches GET /api/v1/public/products?q=…, which is
// answered by the same Meilisearch-first service with the honest
// Postgres fallback, and meta.engine still names the engine that
// actually answered — the page shows it, exactly as before. The URL
// contract is unchanged (?q= only; the GET form still makes results
// shareable).
//
// Honest trade-off: results paint after the client fetch lands
// instead of arriving in the first HTML, and a no-JS crawler sees
// the empty shell rather than a result list. The served metadata was
// already query-independent, so nothing SEO-visible is lost.
// Doc 30: metadata follows the STORE DEFAULT locale (ISR-safe —
// settings store only, no request APIs; see shop/page.tsx).
export async function generateMetadata(): Promise<Metadata> {
  const s = pick(await getStoreDefaultLocale(), STORE_STRINGS);
  return { title: s.searchMetaTitle, description: s.searchMetaDescription };
}

// The shell itself never changes; a long revalidate keeps it a pure
// edge-served static page (all live data arrives via the cached API).
// Perf wave 2A: revalidate alone was NOT enough — the build still
// classified /search ƒ (dynamic), the same silent-dynamic failure
// the homepage had. force-static (the proven homepage fix) makes
// the shell genuinely ISR; the query UI/fetching stays client-side,
// so visitor behaviour is unchanged.
export const dynamic = "force-static";
export const revalidate = 300;

export default function SearchPage() {
  // Wave P5 (doc 32): the fallback is a designed skeleton in the
  // page's own container, so first paint is never a blank shell.
  return (
    <Suspense
      fallback={
        <main className="mx-auto min-w-0 max-w-7xl px-4 py-6">
          <SearchPageSkeleton />
        </main>
      }
    >
      <SearchBrowser />
    </Suspense>
  );
}
