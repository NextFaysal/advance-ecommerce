import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { REVIEW_STATUSES, type ReviewStatus } from "@/reviews/schema";
import { countReviewsByStatus, listReviewsForAdmin } from "@/reviews/store";

// GET /api/v1/admin/reviews — moderation queue.
// RBAC: content.page (same convention as the CMS Pages + Site Content
// APIs — review moderation is content work). ?status=PENDING|APPROVED|
// REJECTED filters; no param returns the latest 100 of every status.
// The phone in each row is MASKED — moderation never needs the raw
// number (verification resolves via the linked customer/order).
export async function GET(req: Request) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const rawStatus = new URL(req.url).searchParams.get("status");
  const status =
    rawStatus && (REVIEW_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as ReviewStatus)
      : undefined;

  const [reviews, counts] = await Promise.all([
    listReviewsForAdmin(status),
    countReviewsByStatus(),
  ]);
  return NextResponse.json({
    data: { reviews, counts },
    meta: { persistence: "database" },
  });
}
