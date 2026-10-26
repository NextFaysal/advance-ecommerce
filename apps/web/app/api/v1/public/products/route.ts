import { NextResponse } from "next/server";
import { getCatalogRepository, handleServiceError } from "@/catalog/api";
import { searchPublicProducts } from "@/catalog/search-service";
import { catalogCacheHeaders } from "@/lib/http-cache";

// GET /api/v1/public/products — public list + search. With ?q= the
// search service answers Meilisearch-first and degrades to Postgres;
// meta.engine names the engine that ACTUALLY answered ("meilisearch"
// or "postgres") — never a pretended source. Cost price is stripped
// by toPublicProduct inside the service, never by the client.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
    const min = url.searchParams.get("minPricePoisha");
    const max = url.searchParams.get("maxPricePoisha");
    const sortParam = url.searchParams.get("sort");
    // Wave 14: repeated `attr=key:value` params (split on the FIRST
    // colon — values may themselves contain colons). Malformed pairs
    // (no colon, empty key or value) are ignored, never fatal.
    const attributeFilters: Record<string, string> = {};
    for (const raw of url.searchParams.getAll("attr")) {
      const sep = raw.indexOf(":");
      if (sep <= 0 || sep === raw.length - 1) continue;
      attributeFilters[raw.slice(0, sep)] = raw.slice(sep + 1);
    }
    const repo = await getCatalogRepository();
    const result = await searchPublicProducts(repo, {
      query: url.searchParams.get("q") ?? undefined,
      categorySlug: url.searchParams.get("category") ?? undefined,
      brandName: url.searchParams.get("brand") ?? undefined,
      attributeFilters: Object.keys(attributeFilters).length > 0 ? attributeFilters : undefined,
      minPricePoisha: min !== null ? Number(min) : undefined,
      maxPricePoisha: max !== null ? Number(max) : undefined,
      inStockOnly: url.searchParams.get("inStock") === "true",
      sort:
        sortParam === "price-asc" || sortParam === "price-desc" || sortParam === "rating" || sortParam === "newest"
          ? sortParam
          : "relevance",
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 20,
    });
    return NextResponse.json(
      {
        data: result.products,
        meta: { total: result.total, page: result.page, pageSize: result.pageSize, engine: result.engine },
      },
      // Speed wave: identical for every visitor — let the CDN serve
      // it (60s fresh + SWR). Checkout re-validates price/stock live.
      { headers: catalogCacheHeaders(60) },
    );
  } catch (error) {
    return handleServiceError(error);
  }
}
