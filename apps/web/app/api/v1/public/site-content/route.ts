import { NextResponse } from "next/server";
import { getStorefrontSiteContent } from "@/cms/site-content";

// GET /api/v1/public/site-content — storefront chrome content.
// Public (it is literally what the header/footer render): menus are
// visible-filtered and hero slides active-only, read from the DB
// (Setting table, cms.* keys — see src/cms/site-content.ts). While a
// section is unconfigured the response carries the BUILT-IN DEFAULTS
// for it and says so in meta.configured — defaults are never passed
// off as owner-saved CMS content. Always dynamic: an admin save must
// show on the next page load, never behind an edge cache.
export const dynamic = "force-dynamic";

export async function GET() {
  const { content, configured } = await getStorefrontSiteContent();
  return NextResponse.json({
    data: content,
    meta: { persistence: "database", configured },
  });
}
