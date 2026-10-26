/**
 * POST /api/v1/public/reviews/[id]/helpful — mark a review helpful.
 *
 * Open to signed-in customers AND guests: the voter key is the
 * customer id when a session exists, otherwise a one-way hash of
 * ip + user-agent (raw values are never stored — see
 * src/reviews/votes.ts). One vote per voter per review, enforced by
 * the (reviewId, voterKey) unique constraint; a repeat POST is a
 * no-op returning the current count with `counted: false`.
 * Only APPROVED reviews are votable — anything else is a 404.
 */
import { NextResponse } from "next/server";
import { errorResponse, requestMeta, requireCustomer } from "@/customer-auth/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { castHelpfulVote, customerVoterKey, guestVoterKey } from "@/reviews/votes";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const customer = await requireCustomer();
  const { ip, userAgent } = requestMeta(req);
  const voterKey = customer ? customerVoterKey(customer.id) : guestVoterKey(ip, userAgent);

  const limit = await checkRateLimit(`review-helpful:${voterKey}`, 60, 3_600_000);
  if (!limit.allowed) {
    return errorResponse(
      "RATE_LIMITED",
      "অনেকবার চেষ্টা করা হয়েছে — কিছুক্ষণ পর আবার চেষ্টা করুন।",
      429,
    );
  }

  const result = await castHelpfulVote(params.id, voterKey);
  if (!result) return errorResponse("NOT_FOUND", "রিভিউটি পাওয়া যায়নি।", 404);

  return NextResponse.json({
    data: { reviewId: params.id, helpfulCount: result.helpfulCount, counted: result.counted },
    meta: { persistence: "database" },
  });
}
