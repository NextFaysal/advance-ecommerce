/**
 * GET /api/v1/themes
 *
 * Public endpoint — returns all themes marked isActive in the catalog.
 * No auth required; theme names and tokens are not sensitive.
 */
import { NextResponse } from "next/server";
import { getThemeCatalog } from "@/lib/theme-repository";

export async function GET() {
  try {
    const catalog = await getThemeCatalog();
    // Public endpoint only exposes active themes.
    const data = catalog.filter((t) => t.isActive);
    return NextResponse.json({ data }, { status: 200 });
  } catch {
    return NextResponse.json({ data: [] }, { status: 200 });
  }
}
