import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fromPoisha } from "@advance-ecommerce/validators";
import { tryCatalogRepository } from "@/catalog/server-read";
import { maxVariantPricePoisha, minVariantPricePoisha, toPublicProduct } from "@/catalog/types";
import { RecordRecentlyViewed } from "@/storefront-ux/components/RecordRecentlyViewed";
import { RecentlyViewedRail } from "@/storefront-ux/components/RecentlyViewedRail";
import { StickyBuyBar } from "@/storefront-ux/components/StickyBuyBar";
import { CompareToggleButton, CompareTray } from "@/storefront-ux/components/CompareTray";
import { SizeGuideButton } from "@/storefront-ux/components/SizeGuideModal";
import { BackInStockForm } from "@/storefront-ux/components/BackInStockForm";
import { BuyBoxActions } from "@/cart/components/BuyBoxActions";
import { WishlistToggleButton } from "@/catalog/WishlistToggleButton";
import { BdtAmount, DigitText } from "@/components/ui/numerals";
import { ReviewSection } from "@/reviews/components/ReviewSection";
import type { RecentlyViewedEntry } from "@/storefront-ux/types";
import { Gallery } from "./Gallery";

// Data: real catalog DB via the repository PUBLIC read path
// (ACTIVE-only) — a DRAFT/ARCHIVED slug 404s exactly like a missing one.
// Design refresh (Direction A): gallery + sticky buy box + trust rows.
// Presentation only — data flow, cart contracts and child components
// are unchanged.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const repo = await tryCatalogRepository();
  const product = repo ? await repo.getPublicProductBySlug(params.slug) : null;
  if (!product) return { title: "পণ্য পাওয়া যায়নি" };
  const title = product.seoTitle?.bn ?? product.title.bn;
  const description = product.seoDescription?.bn ?? product.description.bn;
  // Share image: the product's dedicated OG image wins; otherwise the
  // first gallery image (images arrive sorted by sortOrder).
  const shareImage = product.ogImage ?? product.images[0]?.url;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      ...(shareImage ? { images: [{ url: shareImage, alt: product.title.bn }] } : {}),
    },
    twitter: {
      card: shareImage ? "summary_large_image" : "summary",
      title,
      description,
      ...(shareImage ? { images: [shareImage] } : {}),
    },
  };
}

const trustIconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function StarRow({ rating }: { rating: number }) {
  const full = Math.round(rating);
  return (
    <span className="flex items-center gap-0.5" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg
          key={i}
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill={i <= full ? "#F59E0B" : "none"}
          stroke="#F59E0B"
          strokeWidth="1.8"
          strokeLinejoin="round"
        >
          <path d="M12 3.6l2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L12 16.3l-5.1 2.7 1.1-5.6-4.2-3.9 5.7-.7L12 3.6z" />
        </svg>
      ))}
    </span>
  );
}

const TRUST_ROWS = [
  {
    icon: (
      <svg {...trustIconProps}>
        <rect x="2.5" y="6" width="19" height="12" rx="2" />
        <circle cx="12" cy="12" r="2.6" />
        <path d="M6 9.5h.01M18 14.5h.01" />
      </svg>
    ),
    text: "ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে মূল্য পরিশোধ করুন",
  },
  {
    icon: (
      <svg {...trustIconProps}>
        <path d="M2.5 6h12v11h-12z" />
        <path d="M14.5 10h3.6l3 3.4V17h-6.6" />
        <circle cx="6.5" cy="17.5" r="1.8" />
        <circle cx="17.5" cy="17.5" r="1.8" />
      </svg>
    ),
    text: "সারাদেশে হোম ডেলিভারি — ডেলিভারি চার্জ ও সময় চেকআউটে দেখা যাবে",
  },
  {
    icon: (
      <svg {...trustIconProps}>
        <path d="M8.5 5.5 5 9l3.5 3.5" />
        <path d="M5 9h9a5 5 0 0 1 0 10h-3" />
      </svg>
    ),
    text: "সহজ রিটার্ন সুবিধা — শর্ত প্রযোজ্য",
  },
  {
    icon: (
      <svg {...trustIconProps}>
        <path d="M12 3l7 2.8v5.4c0 4.6-3 7.7-7 9.3-4-1.6-7-4.7-7-9.3V5.8L12 3z" />
        <path d="M9 11.6l2.2 2.2L15.4 9.6" />
      </svg>
    ),
    text: "যাচাই করা অরিজিনাল পণ্য",
  },
] as const;

export default async function ProductPage({ params }: { params: { slug: string } }) {
  const repo = await tryCatalogRepository();
  const raw = repo ? await repo.getPublicProductBySlug(params.slug) : null;
  if (!raw) notFound();
  // Public view: costPoisha stripped — never render cost to customers.
  const product = toPublicProduct(raw);
  const minPrice = minVariantPricePoisha(raw);
  const maxPrice = maxVariantPricePoisha(raw);
  const hasPriceRange = maxPrice > minPrice;
  // Best available discount across active variants (display only).
  const compareCandidates = product.variants
    .filter((v) => v.isActive && v.compareAtPoisha !== null && v.compareAtPoisha > v.pricePoisha)
    .map((v) => ({ price: v.pricePoisha, compare: v.compareAtPoisha as number }));
  const bestDiscount =
    compareCandidates.length > 0
      ? compareCandidates.reduce((a, b) => (b.compare - b.price > a.compare - a.price ? b : a))
      : null;
  const discountPct = bestDiscount
    ? Math.round(((bestDiscount.compare - bestDiscount.price) / bestDiscount.compare) * 100)
    : 0;
  const inStock = product.variants.some((v) => v.isActive && v.stock > 0);
  const hasSizeGuide = product.categorySlug === "fashion";
  const outOfStockVariants = product.variants
    .filter((v) => v.isActive && v.stock === 0)
    .map((v) => ({
      variantId: v.id,
      label: Object.values(v.attributes).join(" / ") || "স্ট্যান্ডার্ড",
    }));
  const recentlyViewedEntry: RecentlyViewedEntry = {
    productId: product.id,
    slug: product.slug,
    titleBn: product.title.bn,
    titleEn: product.title.en,
    pricePoisha: minPrice,
    imageUrl: product.images[0]?.url ?? null,
    viewedAt: new Date().toISOString(),
  };

  // JSON-LD outline — display-only conversion (fromPoisha) for schema.org;
  // internal money stays integer poisha everywhere else.
  const galleryUrls = product.images.map((img) => img.url);
  const firstVariant = product.variants[0];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title.bn,
    description: product.description.bn,
    ...(galleryUrls.length > 0 ? { image: galleryUrls } : {}),
    ...(firstVariant ? { sku: firstVariant.sku } : {}),
    ...(product.reviewCount > 0 && product.ratingAverage !== null
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: product.ratingAverage,
            reviewCount: product.reviewCount,
          },
        }
      : {}),
    brand: product.brandName ? { "@type": "Brand", name: product.brandName } : undefined,
    offers: {
      "@type": "Offer",
      priceCurrency: "BDT",
      price: fromPoisha(minPrice).toFixed(2),
      availability: product.variants.some((v) => v.stock > 0)
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
    },
  };

  return (
    <main className="mx-auto min-w-0 max-w-[1440px] px-4 py-6 sm:px-6 lg:py-8">
      <RecordRecentlyViewed entry={recentlyViewedEntry} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Breadcrumb */}
      <nav aria-label="ব্রেডক্রাম্ব" className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-text-subtle">
        <Link href="/" className="hover:text-brand-700">হোম</Link>
        <span aria-hidden="true">/</span>
        <Link href="/shop" className="hover:text-brand-700">দোকান</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/shop?category=${product.categorySlug}`} className="hover:text-brand-700">
          {product.categoryName.bn}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="max-w-[45vw] truncate font-medium text-text-main">{product.title.bn}</span>
      </nav>

      <div className="mt-5 grid items-start gap-8 lg:grid-cols-2">
        {/* Gallery */}
        <Gallery
          images={product.images.map((img) => ({ url: img.url, altBn: img.altBn }))}
          titleBn={product.title.bn}
        />

        {/* Buy box — sticky on desktop (offset clears the taller
            v3 header: main row + mega-menu row) */}
        <div className="min-w-0 lg:sticky lg:top-[8.5rem]">
          <h1 className="break-words text-[28px] font-extrabold leading-snug text-text-main [overflow-wrap:anywhere]">
            {product.title.bn}
          </h1>
          {product.title.en ? (
            <p className="mt-1 break-words text-sm text-text-subtle [overflow-wrap:anywhere]">{product.title.en}</p>
          ) : null}

          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-text-muted">
            <StarRow rating={product.ratingAverage ?? 0} />
            <span aria-label={`রেটিং ${product.ratingAverage ?? "—"} / ৫`}>
              {product.ratingAverage ?? "—"} ({product.reviewCount}টি রিভিউ)
            </span>
            {product.brandName ? (
              <>
                <span aria-hidden="true" className="text-border">•</span>
                <span>
                  ব্র্যান্ড: <span className="font-semibold text-text-main">{product.brandName}</span>
                </span>
              </>
            ) : null}
            <span aria-hidden="true" className="text-border">•</span>
            <span className={`font-semibold ${inStock ? "text-emerald-600" : "text-rose-600"}`}>
              {inStock ? "স্টকে আছে" : "স্টক শেষ"}
            </span>
          </p>

          <div className="mt-5 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
            {/* Price */}
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-3xl font-extrabold tabular-nums text-brand-700">
                <BdtAmount poisha={minPrice} />
                {hasPriceRange ? (
                  <span className="text-xl">
                    {" "}
                    – <BdtAmount poisha={maxPrice} />
                  </span>
                ) : null}
              </span>
              {bestDiscount ? (
                <>
                  <BdtAmount
                    poisha={bestDiscount.compare}
                    className="text-base tabular-nums text-text-subtle line-through"
                  />
                  <span className="rounded-full bg-rose-600 px-2.5 py-1 text-xs font-bold text-white">
                    <DigitText text={`${discountPct}%`} /> ছাড়
                  </span>
                </>
              ) : null}
            </p>

            {/* Variant price list (info) — the buy box below owns selection */}
            <h2 className="mt-6 text-sm font-bold text-text-main">ভেরিয়েন্ট ও দাম</h2>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {product.variants.map((v) => {
                const soldOut = v.stock <= 0;
                return (
                  <span
                    key={v.id}
                    className={`rounded-xl border px-3 py-1.5 text-[13px] ${
                      soldOut
                        ? "border-border bg-surface-2 text-text-subtle"
                        : "border-border bg-surface text-text-main"
                    }`}
                  >
                    {Object.values(v.attributes).join(" / ") || "স্ট্যান্ডার্ড"} —{" "}
                    <BdtAmount poisha={v.pricePoisha} className="font-semibold tabular-nums" />
                    {soldOut ? " (স্টক শেষ)" : ""}
                  </span>
                );
              })}
            </div>

            <div id="buy-box" className="mt-6">
              {/* Add-to-cart + buy-now (Agent 35): client variant picker +
                  quantity + guest-cart write via src/cart contracts. */}
              <BuyBoxActions
                productId={product.id}
                productTitleBn={product.title.bn}
                imageUrl={product.images[0]?.url ?? null}
                variants={product.variants}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <WishlistToggleButton productId={product.id} />
              <CompareToggleButton productId={product.id} />
              {hasSizeGuide ? <SizeGuideButton /> : null}
            </div>

            <BackInStockForm productId={product.id} variants={outOfStockVariants} />

            {/* Trust rows */}
            <ul className="mt-6 space-y-2.5 border-t border-border pt-5">
              {TRUST_ROWS.map((row) => (
                <li key={row.text} className="flex items-center gap-2.5 text-sm text-text-muted">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    {row.icon}
                  </span>
                  {row.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Description */}
      {product.description.bn ? (
        <section className="mt-10 rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <h2 className="text-lg font-extrabold text-text-main">পণ্যের বিবরণ</h2>
          <p className="mt-3 max-w-3xl break-words text-[15px] leading-8 text-text-muted [overflow-wrap:anywhere]">
            {product.description.bn}
          </p>
        </section>
      ) : null}

      {/* Customer reviews — real APPROVED rows from the Review table
          + the moderated submission form (src/reviews). */}
      <ReviewSection productId={product.id} productSlug={product.slug} />

      <RecentlyViewedRail excludeProductId={product.id} />
      <StickyBuyBar titleBn={product.title.bn} pricePoisha={minPrice} inStock={inStock} buyBoxId="buy-box" />
      <CompareTray />
    </main>
  );
}
