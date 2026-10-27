/**
 * GET /api/v1/themes
 *
 * Public endpoint — returns all themes marked isActive in the catalog
 * (the customer-picker list) plus, under `meta`, the store default
 * theme so first-time visitors can be painted with it. The store
 * default rides in meta (not data) so the picker list keeps its
 * exact publish semantics even when the default theme itself is not
 * published to the picker.
 * No auth required; theme names and tokens are not sensitive.
 */
import { NextResponse } from "next/server";
import { getThemeCatalog } from "@/lib/theme-repository";

// The catalog changes when an admin edits/applies a theme — this response
// must be computed per request (the Cache-Control header below still lets
// the CDN cache it briefly). Without force-dynamic, Next prerenders the
// route at build time and the catalog freezes at its build-time state.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const catalog = await getThemeCatalog();
    // Public endpoint only exposes active themes.
    const data = catalog.filter((t) => t.isActive);
    const storeDefaultTheme = catalog.find((t) => t.isStoreDefault) ?? null;
    return NextResponse.json(
      {
        data,
        meta: {
          storeDefaultThemeId: storeDefaultTheme?.id ?? null,
          storeDefaultTheme,
        },
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { data: [], meta: { storeDefaultThemeId: null, storeDefaultTheme: null } },
      { status: 200 },
    );
  }
}
