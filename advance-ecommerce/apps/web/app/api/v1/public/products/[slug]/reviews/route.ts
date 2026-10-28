import { NextResponse } from "next/server";
import { apiError, getCatalogRepository, handleServiceError } from "@/catalog/api";
import { getPublicProductBySlug } from "@/catalog/service";
import { createReviewSchema } from "@/reviews/schema";
import {
  isReviewHoneypotTripped,
  noteReviewHoneypotDrop,
  reviewRateLimitKey,
} from "@/reviews/policy";
import { checkReviewRateLimit } from "@/reviews/rate-limit";
import { createReview, getApprovedReviewAggregate, listApprovedReviews } from "@/reviews/store";
import { catalogCacheHeaders } from "@/lib/http-cache";

// Live data only: never prerender these handlers at build time.
// (The GET response itself is edge-cached briefly — see below.)
export const dynamic = "force-dynamic";

// GET /api/v1/public/products/[slug]/reviews — APPROVED reviews only,
// plus the aggregate the PDP header shows. The public view carries
// the author's NAME ONLY — Review.phone is verification data and is
// never returned here (see src/reviews/store.ts). The payload is
// identical for every visitor (approved-only, moderation-gated), so
// it carries the wave-45 catalog cache headers (perf wave 2B:
// s-maxage=60 + SWR 300) — a newly approved review can take up to
// ~60s to appear, which moderation timing already dwarfs.
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  try {
    const repo = await getCatalogRepository();
    const product = await getPublicProductBySlug(repo, params.slug);
    if (!product) return apiError("NOT_FOUND", "Product not found.", 404);
    const [reviews, aggregate] = await Promise.all([
      listApprovedReviews(product.id),
      getApprovedReviewAggregate(product.id),
    ]);
    return NextResponse.json(
      {
        data: { productId: product.id, aggregate, reviews },
        meta: { persistence: "database" },
      },
      { headers: catalogCacheHeaders(60) },
    );
  } catch (error) {
    return handleServiceError(error);
  }
}

// POST /api/v1/public/products/[slug]/reviews — submit a review.
// Public (no account needed). The review is born PENDING and becomes
// visible only after admin moderation at /admin/reviews — the success
// copy says exactly that. Spam defences mirror the newsletter
// endpoint: a `website` honeypot (bots get a plausible 201, nothing
// is stored) + a per (phone + IP) rate limit of 5/hour.
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const rawBody: unknown = await req.json().catch(() => null);

  // Honeypot first: a tripped bot gets a plausible success and leaves.
  if (isReviewHoneypotTripped(rawBody)) {
    noteReviewHoneypotDrop();
    return NextResponse.json(
      {
        data: { review: { status: "PENDING" } },
        meta: { persistence: "database" },
      },
      { status: 201 },
    );
  }

  const parsed = createReviewSchema.safeParse(rawBody ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "নাম, সঠিক মোবাইল নম্বর, রেটিং ও রিভিউ লিখুন।" } },
      { status: 400 },
    );
  }

  // IP placeholder: first x-forwarded-for hop until trusted-proxy setup
  // (same convention as the newsletter/contact endpoints).
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0]?.trim() || "unknown";
  const limit = await checkReviewRateLimit(reviewRateLimitKey(parsed.data.phone, ip));
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "অনেকবার চেষ্টা করা হয়েছে — কিছুক্ষণ পর আবার চেষ্টা করুন।",
        },
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const repo = await getCatalogRepository();
    const product = await getPublicProductBySlug(repo, params.slug);
    if (!product) return apiError("NOT_FOUND", "Product not found.", 404);
    await createReview(product.id, parsed.data);
    return NextResponse.json(
      {
        data: { review: { status: "PENDING" } },
        meta: { persistence: "database" },
      },
      { status: 201 },
    );
  } catch (error) {
    return handleServiceError(error);
  }
}
