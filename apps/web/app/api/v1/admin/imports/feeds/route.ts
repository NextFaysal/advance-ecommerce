import { NextResponse } from "next/server";
import { apiError, requireAdminSession } from "@/catalog/api";
import { hasPermission } from "@/lib/rbac";
import { FEED_SUMMARIES, listFeedItems } from "@/importers/feeds";

// GET /api/v1/admin/imports/feeds — ADV-25 feed summary for the
// admin import/export page: the public feed URLs and how many
// products / items each currently carries (one shared eligibility
// rule, so the counts are the same rule applied once).
export async function GET() {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  if (!hasPermission(session.permissions, "products.import")) {
    return apiError("FORBIDDEN", "Missing permission: products.import", 403);
  }
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  let items: Awaited<ReturnType<typeof listFeedItems>> = [];
  let dbReady = true;
  try {
    items = await listFeedItems(baseUrl);
  } catch {
    dbReady = false;
  }
  const productCount = new Set(items.map((i) => i.groupId)).size;
  return NextResponse.json({
    data: {
      generatedAt: new Date().toISOString(),
      dbReady,
      productCount,
      itemCount: items.length,
      feeds: FEED_SUMMARIES.map((feed) => ({
        ...feed,
        productCount,
        itemCount: items.length,
      })),
      eligibility:
        "ACTIVE, not deleted, not scheduled for a future publish date, and not price-on-request. One item per variant (price + stock live on variants).",
    },
  });
}
