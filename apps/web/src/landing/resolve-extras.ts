/**
 * Server-side resolution for the L3 blocks whose data cannot ride
 * the synchronous catalog array (doc 34 §3.2/§3.4): reviews live in
 * the Review table, bundle contents in BundleComponent rows. Both
 * public /lp/[slug] and the admin landing page call this and hand
 * the result to buildLandingViewModel as `extras`; the pure builder
 * preview receives the same records serialized as props.
 *
 * Honesty rules (§0.7) enforced HERE, at the data layer:
 *  - reviews: APPROVED rows only, via the reviews store's own
 *    public reads (listApprovedReviews — name-only, phone never
 *    selected into the view) + the store's live aggregate. The
 *    aggregate reported is the product's TRUE approved
 *    average/count; the section's minRating filters the listed
 *    cards only, never the numbers. Zero approved (or zero at/above
 *    minRating) → null → the block renders nothing. No placeholder
 *    testimonials exist anywhere in this path.
 *  - bundles: the bundle-builder page's OWN read model
 *    (listBundleBuilds) — same component quantities, same totals,
 *    same savings rule, same module gate. A product that is not an
 *    ACTIVE bundle (or the product-types module is off) is simply
 *    absent → null → the block renders nothing.
 *  - collections + flash-sale end (L2): grid/carousel sources
 *    resolve through LandingCatalogQueries (the caller's instance
 *    decides visibility), and a flash-sale-targeted countdown reads
 *    the live sale's endsAt from getLiveFlashSale — no live sale,
 *    no countdown (§0.7).
 *
 * Server-only module: imports Prisma-backed stores. Never import
 * from client components (the builder gets plain records as props).
 */
import { getApprovedReviewAggregate, listApprovedReviews } from "@/reviews/store";
import { listBundleBuilds, type BundleBuild } from "@/marketing/bundle-builder";
import { getLiveFlashSale } from "@/marketing/repository";
import { landingCatalogQueries, resolveLandingCollections, type LandingCatalogQueries } from "./catalog";
import type { LandingPage } from "./types";
import type { BundleBlockData, LandingBlockExtras, ResolvedReviews } from "./render";

/** How many approved rows to scan before the minRating filter +
 *  the section's own limit apply — bounded, like every landing read. */
const REVIEW_SCAN_LIMIT = 100;

async function resolveReviewsSection(
  productId: string,
  limit: number,
  minRating: number,
): Promise<ResolvedReviews | null> {
  const [aggregate, rows] = await Promise.all([
    getApprovedReviewAggregate(productId),
    listApprovedReviews(productId, REVIEW_SCAN_LIMIT),
  ]);
  if (aggregate.count === 0) return null;
  const items = rows
    .filter((r) => r.rating >= minRating)
    .slice(0, limit)
    .map((r) => ({
      authorName: r.authorName,
      rating: r.rating,
      title: r.title,
      body: r.body,
      createdAt: r.createdAt,
      verifiedPurchase: r.verifiedPurchase,
      images: r.images,
    }));
  if (items.length === 0) return null;
  return { productId, average: aggregate.average, count: aggregate.count, items };
}

function toBundleBlockData(build: BundleBuild): BundleBlockData {
  return {
    components: build.components.map((c) => ({
      titleBn: c.titleBn,
      titleEn: c.titleEn,
      productSlug: c.productSlug,
      variantLabel: c.variantLabel,
      quantity: c.quantity,
      unitPricePoisha: c.unitPricePoisha,
      lineTotalPoisha: c.lineTotalPoisha,
    })),
    componentsTotalPoisha: build.componentsTotalPoisha,
    available: build.available,
  };
}

export async function resolveLandingExtras(
  page: Pick<LandingPage, "sections">,
  queries: LandingCatalogQueries = landingCatalogQueries,
): Promise<LandingBlockExtras> {
  const reviews: Record<string, ResolvedReviews | null> = {};
  const bundles: Record<string, BundleBlockData | null> = {};
  // The product a usePrimaryOffer reviews block binds to: the page's
  // first product_offer section (the same ref view.primaryOffer
  // resolves from).
  const primaryOfferProductId =
    page.sections.find((s) => s.type === "product_offer")?.productId || null;

  let bundleBuilds: Promise<BundleBuild[]> | null = null;
  const getBundleBuilds = (): Promise<BundleBuild[]> => {
    // A bundle read failure degrades to "no bundles" (blocks hide,
    // the page still renders) — the landing layer's standing
    // unresolved-means-hidden posture, never a 500 for a campaign.
    bundleBuilds ??= listBundleBuilds()
      .then((r) => r.bundles)
      .catch(() => []);
    return bundleBuilds;
  };

  await Promise.all(
    page.sections.map(async (section) => {
      if (section.type === "reviews") {
        const productId = section.usePrimaryOffer ? primaryOfferProductId : section.productId || null;
        reviews[section.id] = productId
          ? await resolveReviewsSection(productId, section.limit, section.minRating)
          : null;
      } else if (section.type === "bundle_offer") {
        const builds = await getBundleBuilds();
        const build = builds.find((b) => b.productId === section.productId) ?? null;
        bundles[section.id] = build ? toBundleBlockData(build) : null;
      }
    }),
  );

  // L2 dynamic collections (doc 34 §3.4): resolved through the
  // caller's queries instance — the public page passes the public
  // (live-gated) instance, admin surfaces the admin one. Only
  // grid/carousel sections cost queries; other pages resolve to {}.
  const collections = await resolveLandingCollections(page, queries);

  // L2 countdown, flash-sale target: the live sale's own end, or
  // null when no sale is live (the block then renders nothing —
  // §0.7). Only read when a section actually targets the sale; a
  // read failure degrades to null, never a 500 for a campaign page.
  let flashSaleEndsAt: string | null = null;
  if (page.sections.some((s) => s.type === "countdown" && s.target.kind === "flash_sale")) {
    flashSaleEndsAt = await getLiveFlashSale()
      .then((sale) => sale?.endsAt ?? null)
      .catch(() => null);
  }

  return { reviews, bundles, collections, flashSaleEndsAt };
}
