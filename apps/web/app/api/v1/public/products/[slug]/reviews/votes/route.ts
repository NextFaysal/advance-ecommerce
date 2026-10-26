import { NextResponse } from "next/server";
import { apiError, getCatalogRepository, handleServiceError } from "@/catalog/api";
import { getPublicProductBySlug } from "@/catalog/service";
import { getCurrentCustomer } from "@/customer-auth/auth";
import { listApprovedReviews } from "@/reviews/store";
import { customerVoterKey, guestVoterKey, listVotedReviewIds } from "@/reviews/votes";

// Per-viewer state: never prerender/cache these handlers at build time.
export const dynamic = "force-dynamic";

// GET /api/v1/public/products/[slug]/reviews/votes — which of this
// product's APPROVED reviews the CURRENT viewer has already marked
// helpful. The PDP renders statically (ISR), so the pressed state
// can no longer be resolved server-side inside ReviewSection; the
// helpful buttons fetch it from here on mount instead.
//
// VOTER KEY: derived exactly as the vote POST (and previously
// ReviewSection) does it — customerVoterKey(customer.id) when a
// customer session exists, else guestVoterKey(ip, userAgent) with
// ip = first x-forwarded-for hop (or "unknown") and the raw
// user-agent header. Raw ip/ua are only fed into the one-way hash
// inside guestVoterKey; they are never stored or returned.
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  try {
    const repo = await getCatalogRepository();
    const product = await getPublicProductBySlug(repo, params.slug);
    if (!product) return apiError("NOT_FOUND", "Product not found.", 404);

    const customer = await getCurrentCustomer().catch(() => null);
    const voterKey = customer
      ? customerVoterKey(customer.id)
      : guestVoterKey(
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
          req.headers.get("user-agent") ?? undefined,
        );

    const reviews = await listApprovedReviews(product.id).catch(() => []);
    const votedReviewIds =
      reviews.length > 0
        ? await listVotedReviewIds(
            voterKey,
            reviews.map((r) => r.id),
          ).catch(() => [] as string[])
        : [];

    return NextResponse.json(
      { data: { votedReviewIds }, meta: { persistence: "database" } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return handleServiceError(error);
  }
}
