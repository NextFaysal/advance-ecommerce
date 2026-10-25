import { NextResponse } from "next/server";
import { handleServiceError } from "@/catalog/api";
import { listPublicBrands } from "@/catalog/public-brands";

// Live data only: never prerender/cache this GET at build time.
export const dynamic = "force-dynamic";

// GET /api/v1/public/brands — every live brand with ≥1 ACTIVE product:
// { name, slug, productCount }. The /shop sidebar facet reads the same
// helper server-side; this route is the public contract for any other
// consumer (mobile app, headless storefront).
export async function GET() {
  try {
    const brands = await listPublicBrands();
    return NextResponse.json({ data: brands });
  } catch (error) {
    return handleServiceError(error);
  }
}
