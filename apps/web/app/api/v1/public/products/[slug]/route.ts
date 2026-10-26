import { NextResponse } from "next/server";
import { apiError, getCatalogRepository, handleServiceError } from "@/catalog/api";
import { getPublicProductBySlug } from "@/catalog/service";
import { catalogCacheHeaders } from "@/lib/http-cache";

// Speed wave: no build-time prerendering, but the response is
// public and identical for every visitor, so the CDN may cache it
// briefly (60s + SWR via catalogCacheHeaders below). Checkout
// re-validates price/stock live, so a stale card/detail can never
// sell at a wrong price.

// GET /api/v1/public/products/[slug] — public detail, cost stripped.
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  try {
    const repo = await getCatalogRepository();
    const product = await getPublicProductBySlug(repo, params.slug);
    if (!product) return apiError("NOT_FOUND", "Product not found.", 404);
    return NextResponse.json({ data: product }, { headers: catalogCacheHeaders(60) });
  } catch (error) {
    return handleServiceError(error);
  }
}
