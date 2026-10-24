import { NextResponse } from "next/server";
import { apiError, getCatalogRepository, handleServiceError } from "@/catalog/api";
import { getPublicProductBySlug } from "@/catalog/service";

// Live data only: never prerender/cache this GET at build time.
export const dynamic = "force-dynamic";

// GET /api/v1/public/products/[slug] — public detail, cost stripped.
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  try {
    const repo = await getCatalogRepository();
    const product = await getPublicProductBySlug(repo, params.slug);
    if (!product) return apiError("NOT_FOUND", "Product not found.", 404);
    return NextResponse.json({ data: product });
  } catch (error) {
    return handleServiceError(error);
  }
}
