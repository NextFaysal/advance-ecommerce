// GET /feeds/google-shopping.xml — ADV-25 outbound feed (public, no
// auth, cacheable). RSS 2.0 + Google g: namespace, one item per
// variant of every feed-eligible product (ACTIVE, recorded price,
// real stock). Eligibility + builders live in src/importers/feeds.
// An empty catalog — or a DB hiccup — yields a valid empty feed,
// never an error page.
import { buildGoogleShoppingXml, getStoreName, listFeedItems, type FeedItem } from "@/importers/feeds";

export const dynamic = "force-dynamic";

export async function GET() {
  const generatedAt = new Date();
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  let items: FeedItem[] = [];
  let storeName = "";
  try {
    items = await listFeedItems(baseUrl);
    storeName = await getStoreName();
  } catch {
    items = [];
  }
  return new Response(buildGoogleShoppingXml(items, baseUrl, storeName, generatedAt), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "X-Feed-Generated-At": generatedAt.toISOString(),
      "X-Feed-Item-Count": String(items.length),
    },
  });
}
