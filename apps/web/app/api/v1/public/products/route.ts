import { NextResponse } from "next/server";
import { getCatalogRepository, handleServiceError } from "@/catalog/api";
import { getPublicProducts } from "@/catalog/service";

// GET /api/v1/public/products — public list. Cost price is stripped
// by getPublicProducts (toPublicProduct), never by the client.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
    const min = url.searchParams.get("minPricePoisha");
    const max = url.searchParams.get("maxPricePoisha");
    const sortParam = url.searchParams.get("sort");
    const repo = await getCatalogRepository();
    const result = await getPublicProducts(repo, {
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
      meta: { total: result.total, page: result.page, pageSize: result.pageSize },
    });
  } catch (error) {
    return handleServiceError(error);
  }
}
