import { NextResponse } from "next/server";
import { getCatalogRepository, handleServiceError } from "@/catalog/api";

// GET /api/v1/public/categories — public category list.
export async function GET() {
  try {
    const repo = await getCatalogRepository();
    const categories = await repo.getCategories();
    return NextResponse.json({ data: categories });
  } catch (error) {
    return handleServiceError(error);
  }
}
