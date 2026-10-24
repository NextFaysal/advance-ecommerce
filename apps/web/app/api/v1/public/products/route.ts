import { NextResponse } from "next/server";
import { getCatalogRepository, handleServiceError } from "@/catalog/api";
import { searchPublicProducts } from "@/catalog/search-service";

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
    const repo = await getCatalogRepository();
    const result = await searchPublicProducts(repo, {
      query: url.searchParams.get("q") ?? undefined,
      categorySlug: url.searchParams.get("category") ?? undefined,
      brandName: url.searchParams.get("brand") ?? undefined,
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
    return NextResponse.json({
      data: result.products,
      meta: { total: result.total, page: result.page, pageSize: result.pageSize, engine: result.engine },
    });
  } catch (error) {
    // TEMP DIAGNOSTIC (remove after go-live debugging): token-gated error
    // reveal so the production failure can be read without log access.
    const diag = req.headers.get("x-diag");
    if (diag && process.env["DIAG_TOKEN"] && diag === process.env["DIAG_TOKEN"]) {
      const e = error as Error;
      return NextResponse.json(
        { diag: { name: e?.name, message: e?.message, stack: String(e?.stack ?? "").split("\n").slice(0, 6) } },
        { status: 500 },
      );
    }
    return handleServiceError(error);
  }
}
