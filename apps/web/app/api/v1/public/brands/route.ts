import { NextResponse } from "next/server";
import { handleServiceError } from "@/catalog/api";
import { listPublicBrands } from "@/catalog/public-brands";
import { catalogCacheHeaders } from "@/lib/http-cache";

// Speed wave: no build-time prerendering; the CDN may cache the
// response briefly (60s + SWR) — brand edits show within a minute.

// GET /api/v1/public/brands — every live brand with ≥1 ACTIVE product:
// { name, slug, productCount }. The /shop sidebar facet reads the same
// helper server-side; this route is the public contract for any other
// consumer (mobile app, headless storefront).
export async function GET() {
  try {
    const brands = await listPublicBrands();
    return NextResponse.json({ data: brands }, { headers: catalogCacheHeaders(60) });
  } catch (error) {
    return handleServiceError(error);
  }
}
