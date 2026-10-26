// GET /feeds/daraz.csv — ADV-25 outbound feed (public, no auth,
// cacheable). Daraz seller-center template columns — TEMPLATE-BASED,
// like the Daraz importer: the column set targets the commonly
// documented Daraz template and round-trips with
// /api/v1/admin/imports (Daraz). Verify against your seller center
// before submitting. generatedAt rides in the X-Feed-Generated-At
// header (a CSV comment row would break parsers). An empty catalog
// yields a valid header-only CSV, never an error page.
import { buildDarazCatalogCsv, listFeedItems, type FeedItem } from "@/importers/feeds";

export const dynamic = "force-dynamic";

export async function GET() {
  const generatedAt = new Date();
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  let items: FeedItem[] = [];
  try {
    items = await listFeedItems(baseUrl);
  } catch {
    items = [];
  }
  return new Response(buildDarazCatalogCsv(items), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "X-Feed-Generated-At": generatedAt.toISOString(),
      "X-Feed-Item-Count": String(items.length),
    },
  });
}
