import { NextResponse } from "next/server";
import { getStorefrontSiteContent } from "@/cms/site-content";
import { catalogCacheHeaders } from "@/lib/http-cache";

// GET /api/v1/public/site-content — storefront chrome content.
// Public (it is literally what the header/footer render): menus are
// visible-filtered and hero slides active-only, read from the DB
// (Setting table, cms.* keys — see src/cms/site-content.ts). While a
// section is unconfigured the response carries the BUILT-IN DEFAULTS
// for it and says so in meta.configured — defaults are never passed
// off as owner-saved CMS content. The payload is identical for every
// visitor and the storefront shell fetches it on every page view, so
// it is edge-cached (perf wave 2B: s-maxage=300 + SWR 600, the
// site-status/social-proof pattern — force-dynamic stays so the
// origin still computes per revalidation, never frozen at build).
// Trade-off, accepted: an admin CMS save can take up to ~5 minutes
// to reach every visitor through the edge cache.
export const dynamic = "force-dynamic";

export async function GET() {
  const { content, configured } = await getStorefrontSiteContent();
  return NextResponse.json(
    {
      data: content,
      meta: { persistence: "database", configured },
    },
    { headers: catalogCacheHeaders(300, 600) },
  );
}
