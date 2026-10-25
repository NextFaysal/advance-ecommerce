import { NextResponse } from "next/server";
import { handleServiceError } from "@/catalog/api";
import { getPublicCategoryTree } from "@/catalog/category-tree";

// Live data only: never prerender/cache this GET at build time.
export const dynamic = "force-dynamic";

// GET /api/v1/public/categories — public category TREE (Wave 13-2).
// The response keeps every field the flat list always carried
// (slug, name{bn,en}, imageUrl, productCount) on every node, and adds
// `children` (nested sub-categories, recursively) plus the wave-13
// SEO fields (seoTitle / seoDescription, each { bn, en } or null).
// `data` is the array of ROOT categories in the same order as before.
export async function GET() {
  try {
    const categories = await getPublicCategoryTree();
    return NextResponse.json({ data: categories });
  } catch (error) {
    return handleServiceError(error);
  }
}
