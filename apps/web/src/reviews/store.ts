/**
 * Reviews store — Prisma-backed (Review table, migration
 * 20261025043359_reviews_and_small_fixes). Server-only.
 *
 * PRIVACY CONTRACT: Review.phone is stored (normalized) for
 * verification ONLY. No function in this module returns the raw phone
 * on a public view; the admin moderation view returns it MASKED via
 * maskPhone(). Public views carry the author's name only.
 *
 * AGGREGATE CONTRACT: Product.ratingAverage / reviewCount are the
 * denormalized aggregate over APPROVED, non-deleted reviews. They are
 * recomputed by syncProductReviewAggregate() after every moderation
 * change, so ProductCard / PDP header / list reads stay correct with
 * zero extra queries. PENDING and REJECTED reviews never count.
 *
 * VERIFIED PURCHASE: the badge means the reviewer actually
 * RECEIVED the product — the linked customer has a DELIVERED order
 * containing it. It is computed from real Order / OrderItem rows at
 * read time (src/reviews/verified.ts), never from a stored flag, so
 * it stays correct as order statuses change. At submission time the
 * phone is matched to a Customer and, when one exists, the most
 * recent DELIVERED order containing this product is linked
 * (customerId + orderId) as supporting evidence.
 */
import { prisma } from "@advance-ecommerce/db";
import { maskPhone } from "@/checkout/validation";
import type { CreateReviewInput, ReviewStatus } from "./schema";
import { computeVerifiedPurchaseKeys, verifiedPurchaseKey } from "./verified";

/* ------------------------------ views ------------------------------ */

/** Public view — name only. The phone NEVER leaves the server here. */
export interface PublicReview {
  id: string;
  authorName: string;
  rating: number;
  title: string | null;
  body: string;
  createdAt: string;
  verifiedPurchase: boolean;
  /** Denormalized helpful-vote count (Review.helpfulCount, kept in
   *  sync by src/reviews/votes.ts in the vote transaction). */
  helpfulCount: number;
  /** Stored review photo URLs (Review.images). Upload stays gated by
   *  the photo probe (src/reviews/photo.ts) until storage is
   *  configured; rows that carry URLs render them on the PDP. */
  images: string[];
}

export interface ReviewAggregate {
  /** Mean rating over APPROVED reviews, 1 decimal; null when none. */
  average: number | null;
  count: number;
}

/** Admin moderation view — phone included but MASKED. */
export interface AdminReview {
  id: string;
  productId: string;
  productTitleBn: string;
  productSlug: string;
  authorName: string;
  phoneMasked: string;
  rating: number;
  title: string | null;
  body: string;
  status: ReviewStatus;
  verifiedPurchase: boolean;
  createdAt: string;
}

/** Homepage "customer words" view — a real approved review + product. */
export interface HomepageReview {
  id: string;
  authorName: string;
  rating: number;
  title: string | null;
  body: string;
  productTitleBn: string;
  productSlug: string;
  createdAt: string;
}

/* ---------------------------- internals ---------------------------- */

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

type ReviewRow = Awaited<ReturnType<typeof prisma.review.findMany>>[number];

function toPublicReview(row: ReviewRow, verifiedPurchase: boolean): PublicReview {
  return {
    id: row.id,
    authorName: row.authorName,
    rating: row.rating,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    verifiedPurchase,
    helpfulCount: row.helpfulCount,
    images: row.images,
  };
}

function isVerified(
  verifiedKeys: Set<string>,
  row: { customerId: string | null; productId: string },
): boolean {
  return (
    row.customerId !== null &&
    verifiedKeys.has(verifiedPurchaseKey(row.customerId, row.productId))
  );
}

/* ------------------------------ writes ----------------------------- */

/**
 * Create a PENDING review. Resolves the reviewer from the (already
 * normalized) phone: Customer by phone, then their most recent
 * DELIVERED order containing this product — the only order link
 * that supports a verified-purchase claim (see ./verified.ts).
 */
export async function createReview(
  productId: string,
  input: CreateReviewInput,
): Promise<{ id: string; status: ReviewStatus }> {
  let customerId: string | null = null;
  let orderId: string | null = null;

  const customer = await prisma.customer.findFirst({
    where: { phone: input.phone, deletedAt: null },
    select: { id: true },
  });
  if (customer) {
    customerId = customer.id;
    const item = await prisma.orderItem.findFirst({
      where: {
        variant: { productId },
        order: { customerId: customer.id, status: "DELIVERED" },
      },
      orderBy: { createdAt: "desc" },
      select: { orderId: true },
    });
    if (item) orderId = item.orderId;
  }

  const row = await prisma.review.create({
    data: {
      productId,
      customerId,
      orderId,
      authorName: input.authorName,
      phone: input.phone,
      rating: input.rating,
      title: input.title ?? null,
      body: input.body,
      status: "PENDING",
    },
    select: { id: true, status: true },
  });
  return { id: row.id, status: row.status as ReviewStatus };
}

/**
 * Recompute Product.ratingAverage / reviewCount from APPROVED,
 * non-deleted reviews. Called after every moderation transition.
 */
export async function syncProductReviewAggregate(productId: string): Promise<ReviewAggregate> {
  const aggregate = await getApprovedReviewAggregate(productId);
  await prisma.product.update({
    where: { id: productId },
    data: { ratingAverage: aggregate.average, reviewCount: aggregate.count },
  });
  return aggregate;
}

/**
 * Set a review's moderation status and keep the product aggregate in
 * sync. Returns the updated admin view, or null when not found.
 */
export async function setReviewStatus(id: string, status: ReviewStatus): Promise<AdminReview | null> {
  const existing = await prisma.review.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, productId: true },
  });
  if (!existing) return null;
  await prisma.review.update({ where: { id }, data: { status } });
  await syncProductReviewAggregate(existing.productId);
  const rows = await listReviewsForAdmin(undefined, id);
  return rows[0] ?? null;
}

/* ------------------------------ reads ------------------------------ */

/** APPROVED reviews for the PDP, newest first. Name-only public view. */
export async function listApprovedReviews(productId: string, take = 20): Promise<PublicReview[]> {
  const rows = await prisma.review.findMany({
    where: { productId, status: "APPROVED", deletedAt: null },
    orderBy: { createdAt: "desc" },
    take,
  });
  const verifiedKeys = await computeVerifiedPurchaseKeys(rows);
  return rows.map((row) => toPublicReview(row, isVerified(verifiedKeys, row)));
}

/** Live aggregate over APPROVED, non-deleted reviews. */
export async function getApprovedReviewAggregate(productId: string): Promise<ReviewAggregate> {
  const result = await prisma.review.aggregate({
    where: { productId, status: "APPROVED", deletedAt: null },
    _avg: { rating: true },
    _count: { _all: true },
  });
  return {
    average: result._avg.rating !== null ? round1(result._avg.rating) : null,
    count: result._count._all,
  };
}

/**
 * Moderation queue. With `onlyId`, returns just that review (used to
 * re-read after a status change). Phone is MASKED in this view.
 */
export async function listReviewsForAdmin(status?: ReviewStatus, onlyId?: string): Promise<AdminReview[]> {
  const rows = await prisma.review.findMany({
    where: {
      deletedAt: null,
      ...(onlyId ? { id: onlyId } : status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: onlyId ? 1 : 100,
    include: { product: { select: { titleBn: true, slug: true } } },
  });
  const verifiedKeys = await computeVerifiedPurchaseKeys(rows);
  return rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    productTitleBn: row.product.titleBn,
    productSlug: row.product.slug,
    authorName: row.authorName,
    phoneMasked: maskPhone(row.phone),
    rating: row.rating,
    title: row.title,
    body: row.body,
    status: row.status as ReviewStatus,
    verifiedPurchase: isVerified(verifiedKeys, row),
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Per-status counts for the moderation tabs. */
export async function countReviewsByStatus(): Promise<Record<ReviewStatus, number>> {
  const grouped = await prisma.review.groupBy({
    by: ["status"],
    where: { deletedAt: null },
    _count: { _all: true },
  });
  const counts: Record<ReviewStatus, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
  for (const g of grouped) {
    if (g.status === "PENDING" || g.status === "APPROVED" || g.status === "REJECTED") {
      counts[g.status] = g._count._all;
    }
  }
  return counts;
}

/**
 * Homepage testimonials source: the latest APPROVED reviews with
 * rating >= 4 across all products. Real customer words only — when
 * this returns [], the homepage section renders nothing.
 */
export async function listHomepageReviews(take = 6): Promise<HomepageReview[]> {
  const rows = await prisma.review.findMany({
    where: { status: "APPROVED", rating: { gte: 4 }, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take,
    include: { product: { select: { titleBn: true, slug: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    authorName: row.authorName,
    rating: row.rating,
    title: row.title,
    body: row.body,
    productTitleBn: row.product.titleBn,
    productSlug: row.product.slug,
    createdAt: row.createdAt.toISOString(),
  }));
}
