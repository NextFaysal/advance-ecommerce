// GET /feeds/facebook-catalog.csv — ADV-25 outbound feed (public,
// no auth, cacheable). Facebook catalog CSV columns:
// id,title,description,availability,condition,price,link,image_link,
// brand — one row per variant of every feed-eligible product.
// generatedAt rides in the X-Feed-Generated-At header because a CSV
// comment row would break catalog parsers. An empty catalog yields
// a valid header-only CSV, never an error page.
import { buildFacebookCatalogCsv, listFeedItems, type FeedItem } from "@/importers/feeds";

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
  return new Response(buildFacebookCatalogCsv(items), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "X-Feed-Generated-At": generatedAt.toISOString(),
      "X-Feed-Item-Count": String(items.length),
    },
  });
}
