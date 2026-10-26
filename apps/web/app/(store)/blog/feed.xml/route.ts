/**
 * GET /blog/feed.xml — RSS 2.0 feed of the latest published posts
 * (ADV-17). Built from the same visibility-filtered read path as
 * the blog index; with no published posts the feed is a valid,
 * empty channel — never placeholder items.
 */
import { buildBlogRssXml, listPublishedPostsForFeed } from "@/cms/blog";

export const dynamic = "force-dynamic";

export async function GET() {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const posts = await listPublishedPostsForFeed(20);
  const xml = buildBlogRssXml(posts, {
    baseUrl,
    siteTitle: "Advance Ecommerce — ব্লগ",
    siteDescription: "কেনাকাটার টিপস, পণ্যের গাইড আর আমাদের গল্প।",
  });
  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
