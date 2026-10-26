import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fromPoisha } from "@advance-ecommerce/validators";
import { tryCatalogRepository } from "@/catalog/server-read";
import { maxVariantPricePoisha, minVariantPricePoisha, toPublicProduct } from "@/catalog/types";
import { EmiNote } from "@/marketing/components/EmiNote";
import { RecordRecentlyViewed } from "@/storefront-ux/components/RecordRecentlyViewed";
import { RecentlyViewedRail } from "@/storefront-ux/components/RecentlyViewedRail";
import { StickyBuyBar } from "@/storefront-ux/components/StickyBuyBar";
import { CompareToggleButton, CompareTray } from "@/storefront-ux/components/CompareTray";
import { BackInStockForm } from "@/storefront-ux/components/BackInStockForm";
import { BuyBoxActions } from "@/cart/components/BuyBoxActions";
import { WishlistToggleButton } from "@/catalog/WishlistToggleButton";
import { ProductCard } from "@/catalog/ProductCard";
import { renderDescriptionHtml } from "@/catalog/description";
import { getRelatedProducts } from "@/catalog/related";
import {
  bundleAvailabilityState,
  formatFileSize,
  productTypeOf,
  type PublicProductWithTypeFields,
} from "@/catalog/product-type-contract";
import { BdtAmount, DigitText } from "@/components/ui/numerals";
import { Reveal } from "@/components/ui/reveal";
import { ReviewSection } from "@/reviews/components/ReviewSection";
import { QuestionsSection } from "@/qa/components/QuestionsSection";
import type { RecentlyViewedEntry } from "@/storefront-ux/types";
import { Gallery } from "./Gallery";
import { SpinViewer } from "./SpinViewer";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { DescriptionSection } from "./DescriptionSection";
import { ProductVideo } from "./ProductVideo";
import { SizeChartButton, SizeChartSection } from "./SizeChart";
import { resolvePdpPackSizeChart } from "@/business-modules/fashion-wiring";
import { getAgeRestrictionForCategorySlug } from "@/catalog/age-restrictions";
import { AgeGate } from "./AgeGate";
import { getWeightedInfosForProduct } from "@/business-modules/grocery-pricing";

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
  // Wave 15-3: 360° spin viewer (module.product_extras) for products
  // with enough gallery frames to spin.
  await ensureDbFeatureFlags();
  const spinEnabled = isFeatureEnabled("module.product_extras") && raw.images.length >= 6;
  // Public view: costPoisha stripped — never render cost to customers.
  const product = toPublicProduct(raw);
  const minPrice = minVariantPricePoisha(raw);
  // Price-on-request (schema wave 2): the price, variant prices,
  // buy box, EMI note, sticky bar and JSON-LD offers are ALL hidden
  // below — the customer asks via the contact/inbox path instead.
  const priceOnRequest = product.priceOnRequest;
  // Age gate (ADV-29): when the product's category is configured
  // age-restricted (Settings catalog.age_restricted_categories),
  // the buy box below is wrapped in the AgeGate interstitial — a
  // self-declaration prompt, not verification; the binding gate is
  // the checkout refusal in the orders route.
  const ageRestriction = priceOnRequest
    ? null
    : await getAgeRestrictionForCategorySlug(product.categorySlug);
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
  // Product types (wave 15, doc 16 §P7): the public shape carries
  // `type` + the per-type blocks (toPublicProduct's spread preserves
  // them). SIMPLE — the default whenever the module flag is off —
  // changes nothing on this page.
  const typeFields = product as PublicProductWithTypeFields;
  const productType = productTypeOf(typeFields);
  const digitalFiles = typeFields.digitalFiles ?? [];
  const bundleComponents = typeFields.bundleComponents ?? [];
  // The service's fulfilment verdict for bundles; null = it said
  // nothing, so the bundle keeps the variant-stock behaviour.
  const bundleAvailable =
    productType === "BUNDLE" ? bundleAvailabilityState(typeFields) : null;
  const bundleUnavailable = bundleAvailable === false;
  // The service's numeric bundle count (wave-15 parent fix): a bundle
  // variant's own stock cache is not the sellable count, so the buy
  // box is fed the component-derived count (server re-checks anyway).
  const bundleCount =
    productType === "BUNDLE" && typeof typeFields.bundleAvailability === "number"
      ? typeFields.bundleAvailability
      : null;
  const displayInStock = bundleUnavailable ? false : bundleCount !== null ? bundleCount > 0 : inStock;
  const preorder = typeFields.preorder ?? null;
  const preorderExpectedLabel = preorder?.expectedDate
    ? (() => {
        const d = new Date(preorder.expectedDate as string);
        return Number.isNaN(d.getTime())
          ? null
          : d.toLocaleDateString("bn-BD", { day: "numeric", month: "long", year: "numeric" });
      })()
    : null;
  // Component sum for the "buy separately vs bundle" line — only
  // when EVERY component carries a public price; otherwise the line
  // is skipped rather than showing a partial (wrong) total.
  const bundleComponentsTotal =
    bundleComponents.length > 0 &&
    bundleComponents.every((c) => typeof c.unitPricePoisha === "number")
      ? bundleComponents.reduce((s, c) => s + (c.unitPricePoisha as number) * c.quantity, 0)
      : null;
  // Sale window (Wave 14-2): when the product carries a sale window
  // (saleStartsAt/saleEndsAt) that is NOT currently active, the
  // compare-at strike + discount badge are hidden — the price itself
  // never changes. No window (or an active one) keeps today's
  // behaviour; `saleActive` arrives derived on the public shape.
  const hasSaleWindow = Boolean(product.saleStartsAt || product.saleEndsAt);
  const showDiscount = bestDiscount !== null && (!hasSaleWindow || product.saleActive);
  // Per-product size chart replaces the old categorySlug === "fashion"
  // hardcode: the button/section exist only when THIS product has one.
  const sizeChart =
    product.sizeChart && product.sizeChart.headers.length > 0 && product.sizeChart.rows.length > 0
      ? product.sizeChart
      : null;
  // ADV-22 (fashion pack): when the product has NO chart of its own,
  // the pack chart for its category is the fallback (per-category
  // override, else the pack default) — resolved from the saved pack
  // config, only while module.fashion is on. The product's own chart
  // always wins. The pack chart also carries the category fit note.
  const packSizeChart = !sizeChart ? await resolvePdpPackSizeChart(product.categorySlug) : null;
  const displaySizeChart = sizeChart ?? packSizeChart?.table ?? null;
  // ADV-22 (grocery pack): weighted (per-kg) pack annotations for this
  // product's configured pack variants — rate + pack weight from the
  // saved grocery config; empty unless module.grocery is on and this
  // product has configured weighted variants.
  const weightedInfos = await getWeightedInfosForProduct(product.id);
  const faqItems = (product.faqItems ?? []).filter((f) => f.q.trim() !== "" && f.a.trim() !== "");
  // Specification table: union of variant attributes, key → distinct
  // values in first-seen order (active variants preferred).
  const specRows: Array<{ key: string; values: string[] }> = [];
  {
    const byKey = new Map<string, string[]>();
    const specVariants = product.variants.filter((v) => v.isActive);
    for (const v of specVariants.length > 0 ? specVariants : product.variants) {
      for (const [key, value] of Object.entries(v.attributes)) {
        const list = byKey.get(key) ?? [];
        if (!list.includes(value)) list.push(value);
        byKey.set(key, list);
      }
    }
    for (const [key, values] of byKey) specRows.push({ key, values });
  }
  const related = await getRelatedProducts(product);
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
    // No offers block for price-on-request products: publishing a
    // price in structured data would defeat the point of hiding it.
    ...(priceOnRequest
      ? {}
      : {
          offers: {
            "@type": "Offer",
            priceCurrency: "BDT",
            price: fromPoisha(minPrice).toFixed(2),
            availability: product.variants.some((v) => v.stock > 0)
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
          },
        }),
  };

  return (
    <main className="mx-auto min-w-0 max-w-[1440px] px-4 py-6 sm:px-6 lg:py-8">
      <RecordRecentlyViewed entry={recentlyViewedEntry} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Breadcrumb */}
      <nav aria-label="ব্রেডক্রাম্ব" className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-text-subtle">
        <Link href="/" className="py-1 transition hover:text-brand-700 dark:hover:text-brand-300">হোম</Link>
        <span aria-hidden="true" className="text-border">/</span>
        <Link href="/shop" className="py-1 transition hover:text-brand-700 dark:hover:text-brand-300">দোকান</Link>
        <span aria-hidden="true" className="text-border">/</span>
        <Link href={`/shop?category=${product.categorySlug}`} className="py-1 transition hover:text-brand-700 dark:hover:text-brand-300">
          {product.categoryName.bn}
        </Link>
        <span aria-hidden="true" className="text-border">/</span>
        <span className="max-w-[45vw] truncate py-1 font-medium text-text-main">{product.title.bn}</span>
      </nav>

      <div className="mt-5 grid items-start gap-8 lg:grid-cols-2">
        {/* Gallery + product video (gallery-adjacent, same column) */}
        <div className="min-w-0 space-y-4">
          <Gallery
            images={product.images.map((img) => ({ url: img.url, altBn: img.altBn }))}
            titleBn={product.title.bn}
          />
          {product.videoUrl ? <ProductVideo videoUrl={product.videoUrl} titleBn={product.title.bn} /> : null}
          {spinEnabled ? (
            <SpinViewer images={product.images.map((i) => i.url)} title={product.title.bn} />
          ) : null}
        </div>

        {/* Buy box — sticky on desktop (offset clears the taller
            v3 header: main row + mega-menu row) */}
        <div className="min-w-0 lg:sticky lg:top-[8.5rem]">
          {productType === "PREORDER" ? (
            <span className="mb-3 inline-flex rounded-full bg-sky-600 px-3 py-1 text-xs font-bold text-white shadow-md">
              প্রি-অর্ডার
            </span>
          ) : null}
          <h1 className="break-words font-display text-[clamp(1.625rem,3.5vw,2.125rem)] font-extrabold leading-[1.25] text-text-main [overflow-wrap:anywhere]">
            {product.title.bn}
          </h1>
          {product.title.en ? (
            <p className="mt-1.5 break-words text-sm text-text-subtle [overflow-wrap:anywhere]">{product.title.en}</p>
          ) : null}

          <p className="mt-4 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1.5 rounded-2xl bg-surface-2/70 px-3.5 py-2 text-sm text-text-muted">
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
            <span className={`font-semibold ${displayInStock ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
              {displayInStock ? "স্টকে আছে" : "স্টক শেষ"}
            </span>
          </p>

          <div className="relative mt-5 overflow-hidden rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
            {/* Aurora accent hairline — decorative top edge of the buy card */}
            <div aria-hidden="true" className="brand-gradient absolute inset-x-0 top-0 h-1" />
            {/* Price — or the price-on-request label (schema wave 2) */}
            {priceOnRequest ? (
              <p className="pt-1 font-display text-3xl font-extrabold text-brand-700 dark:text-brand-300">
                দামের জন্য যোগাযোগ করুন
              </p>
            ) : (
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 pt-1">
              <span className="font-display text-4xl font-extrabold tabular-nums text-brand-700 dark:text-brand-300">
                <BdtAmount poisha={minPrice} />
                {hasPriceRange ? (
                  <span className="text-[1.35rem]">
                    {" "}
                    – <BdtAmount poisha={maxPrice} />
                  </span>
                ) : null}
              </span>
              {showDiscount && bestDiscount ? (
                <>
                  <BdtAmount
                    poisha={bestDiscount.compare}
                    className="text-lg tabular-nums text-text-subtle line-through"
                  />
                  <span className="rounded-full bg-rose-600 px-3 py-1 text-[13px] font-bold text-white shadow-sm">
                    <DigitText text={`${discountPct}%`} /> ছাড়
                  </span>
                </>
              ) : null}
            </p>
            )}

            {/* Variant list (info) — the buy box below owns selection.
                Prices are omitted for price-on-request products. */}
            <h2 className="mt-6 text-sm font-bold text-text-main">
              {priceOnRequest ? "ভেরিয়েন্ট" : "ভেরিয়েন্ট ও দাম"}
            </h2>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {product.variants.map((v) => {
                const soldOut = v.stock <= 0;
                return (
                  <span
                    key={v.id}
                    className={`rounded-full border px-3.5 py-2 text-[13px] transition duration-200 ${
                      soldOut
                        ? "border-border bg-surface-2 text-text-subtle"
                        : "border-border bg-surface text-text-main hover:border-brand-300"
                    }`}
                  >
                    {Object.values(v.attributes).join(" / ") || "স্ট্যান্ডার্ড"}
                    {priceOnRequest ? null : (
                      <>
                        {" "}—{" "}
                        <BdtAmount poisha={v.pricePoisha} className="font-semibold tabular-nums" />
                      </>
                    )}
                    {soldOut ? " (স্টক শেষ)" : ""}
                  </span>
                );
              })}
            </div>

            {/* Product-type notices (wave 15) — inside the buy card,
                right where the buying decision happens. */}
            {productType === "DIGITAL" ? (
              <div className="mt-6 rounded-2xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-400/25 dark:bg-violet-500/10">
                <p className="text-sm font-bold text-violet-900 dark:text-violet-100">
                  📥 ডিজিটাল পণ্য — পেমেন্টের পরেই ডাউনলোড লিংক
                </p>
                <p className="mt-1 text-sm leading-relaxed text-violet-800 dark:text-violet-200">
                  এটি কোনো ফিজিক্যাল পণ্য নয়, কুরিয়ারে কিছু আসবে না — পেমেন্ট সম্পূর্ণ হলেই
                  ডাউনলোড লিংক (আর লাইসেন্স কী থাকলে সেটিও) পৌঁছে যাবে।
                </p>
                {digitalFiles.length > 0 ? (
                  <ul className="mt-3 space-y-1.5 border-t border-violet-200 pt-3 text-sm text-violet-900 dark:border-violet-400/20 dark:text-violet-100">
                    {digitalFiles.map((f, i) => (
                      <li key={`${f.fileName}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{f.fileName}</span>
                        <span className="shrink-0 text-xs text-violet-700 dark:text-violet-300">
                          <DigitText text={formatFileSize(f.sizeBytes)} />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {productType === "PREORDER" ? (
              <div className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900 dark:border-sky-400/25 dark:bg-sky-500/10 dark:text-sky-100">
                <p className="font-bold">🗓️ এটি একটি প্রি-অর্ডার পণ্য — এখন বুকিং চলছে</p>
                {preorderExpectedLabel ? (
                  <p className="mt-1">
                    সম্ভাব্য ডেলিভারি: <span className="font-semibold">{preorderExpectedLabel}</span>
                  </p>
                ) : null}
                {preorder?.depositPercent != null ? (
                  <p className="mt-1">
                    বুকিং কনফার্ম করতে অগ্রিম{" "}
                    <span className="font-semibold">
                      <DigitText text={`${preorder.depositPercent}%`} />
                    </span>{" "}
                    দিতে হবে — বাকি টাকা ডেলিভারির সময়।
                  </p>
                ) : null}
                {preorder?.maxUnits != null ? (
                  <p className="mt-1">
                    সীমিত প্রি-অর্ডার: সর্বোচ্চ <DigitText text={`${preorder.maxUnits}`} />
                    টি পর্যন্ত বুকিং নেওয়া হবে।
                  </p>
                ) : null}
              </div>
            ) : null}

            {productType === "BUNDLE" && bundleUnavailable ? (
              <p className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700 dark:border-rose-400/25 dark:bg-rose-500/10 dark:text-rose-200">
                এই বান্ডলের অন্তত একটি কম্পোনেন্ট আপাতত স্টকে নেই — তাই বান্ডলটি এখন কেনা যাচ্ছে না।
              </p>
            ) : null}

            <div id="buy-box" className="mt-6 scroll-mt-32">
              {priceOnRequest ? (
                /* Price-on-request (schema wave 2): no cart, no
                   buy-now — the customer asks through the contact /
                   inbox path and staff quote a price there. */
                <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-400/25 dark:bg-brand-500/10">
                  <p className="text-sm font-bold text-brand-900 dark:text-brand-100">
                    এই পণ্যের দাম অনুরোধে জানানো হয়
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-brand-800 dark:text-brand-200">
                    দাম জানতে আমাদের বার্তা পাঠান — পণ্যের নামটি উল্লেখ করলেই স্টাফ দাম ও
                    অর্ডারের ব্যবস্থা করে দেবেন।
                  </p>
                  <Link
                    href="/contact"
                    className="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    দামের জন্য যোগাযোগ করুন
                  </Link>
                </div>
              ) : (
              <>
              {/* Add-to-cart + buy-now (Agent 35): client variant picker +
                  quantity + guest-cart write via src/cart contracts.
                  ADV-29: wrapped in the age gate when this product's
                  category is age-restricted (minAge null = no gate). */}
              <AgeGate productId={product.id} minAge={ageRestriction?.minAge ?? null}>
              <BuyBoxActions
                productId={product.id}
                productTitleBn={product.title.bn}
                imageUrl={product.images[0]?.url ?? null}
                variants={
                  bundleCount !== null
                    ? product.variants.map((v) => ({ ...v, stock: bundleCount }))
                    : product.variants
                }
                {...(productType === "PREORDER"
                  ? { ctaLabel: "প্রি-অর্ডার করুন", buyNowLabel: "এখনই প্রি-অর্ডার করুন" }
                  : {})}
                {...(bundleUnavailable
                  ? { forceUnavailable: true, unavailableLabel: "বান্ডল স্টকে নেই" }
                  : {})}
              />
              </AgeGate>
              </>
              )}
            </div>

            {/* EMI breakdown (ADV-18B) — display-only bank-card terms
                at the product's lowest variant price; self-gating.
                Hidden for price-on-request products (no price shown). */}
            {priceOnRequest ? null : <EmiNote totalPoisha={minPrice} />}

            {/* ADV-22 (grocery pack): weighted products sell as fixed
                weight packs priced from a per-kg rate. The annotation
                states the rate + pack weight; the derived pack price
                is quoted ONLY when it equals the recorded variant
                price (inSync) — a rate edited since the last admin
                price sync is never presented as the current price.
                Hidden entirely for price-on-request products. */}
            {weightedInfos.length > 0 && !priceOnRequest ? (
              <div className="mt-4 rounded-2xl border border-border bg-surface-2/60 p-4 text-sm leading-6">
                <p className="font-semibold text-text-main">⚖️ ওজন অনুযায়ী দাম — নির্ধারিত ওজনের প্যাকে বিক্রি হয়</p>
                <ul className="mt-2 space-y-1.5 text-text-muted">
                  {weightedInfos.map((info) => {
                    const variant = product.variants.find((v) => v.id === info.variantId);
                    const label = variant
                      ? Object.values(variant.attributes).join(" / ") || info.sku
                      : info.sku;
                    return (
                      <li key={info.variantId}>
                        <span className="font-medium text-text-main">{label}</span>
                        {" — "}প্যাক: <DigitText text={`${info.packGrams}`} /> গ্রাম · প্রতি কেজি{" "}
                        <BdtAmount poisha={info.pricePerKgPoisha} />
                        {info.inSync ? (
                          <>
                            {" "}· প্যাকের দাম <BdtAmount poisha={info.derivedPricePoisha} />
                          </>
                        ) : (
                          <span className="text-text-subtle">
                            {" "}· (হার অনুযায়ী দাম হালনাগাদ বাকি — উপরে দেখানো দামই প্রযোজ্য)
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <WishlistToggleButton productId={product.id} />
              <CompareToggleButton productId={product.id} />
              {displaySizeChart ? <SizeChartButton chart={displaySizeChart} /> : null}
            </div>

            <BackInStockForm productId={product.id} variants={outOfStockVariants} />

            {/* Trust rows — 2-col tile grid on sm+, stacked on phones */}
            <ul className="mt-6 grid gap-2.5 border-t border-border pt-5 sm:grid-cols-2">
              {TRUST_ROWS.map((row) => (
                <li key={row.text} className="flex items-center gap-3 rounded-2xl bg-surface-2/60 p-3 text-sm leading-snug text-text-muted">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
                    {row.icon}
                  </span>
                  {row.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Description — markdown rendered via the shared renderer
          (src/catalog/description.ts); English toggle when present. */}
      {product.description.bn ? (
        <Reveal>
          <DescriptionSection
            bnHtml={renderDescriptionHtml(product.description.bn)}
            enHtml={product.description.en ? renderDescriptionHtml(product.description.en) : null}
          />
        </Reveal>
      ) : null}

      {/* Specification — union of variant attributes */}
      {specRows.length > 0 ? (
        <Reveal>
          <section className="mt-10 rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8">
            <h2 className="font-display text-xl font-extrabold text-text-main">স্পেসিফিকেশন</h2>
            <dl className="mt-4 max-w-3xl">
              {specRows.map((row) => (
                <div
                  key={row.key}
                  className="grid grid-cols-[110px_1fr] gap-3 rounded-xl px-3 py-2.5 text-[15px] odd:bg-surface-2/50 sm:grid-cols-[180px_1fr]"
                >
                  <dt className="font-semibold capitalize text-text-main">{row.key}</dt>
                  <dd className="break-words text-text-muted">{row.values.join(", ")}</dd>
                </div>
              ))}
            </dl>
          </section>
        </Reveal>
      ) : null}

      {/* Size chart — the product's own chart, or the fashion pack's
          chart for its category (ADV-22) when it has none. */}
      {displaySizeChart ? (
        <Reveal>
          <SizeChartSection chart={displaySizeChart} />
          {packSizeChart && (packSizeChart.fitNoteBn || packSizeChart.fitNoteEn) ? (
            <p className="mt-3 text-sm text-text-muted">
              <span className="font-semibold text-text-main">ফিট নোট: </span>
              {packSizeChart.fitNoteBn ?? packSizeChart.fitNoteEn}
              {packSizeChart.fitNoteEn && packSizeChart.fitNoteBn ? (
                <span className="text-text-subtle"> · {packSizeChart.fitNoteEn}</span>
              ) : null}
            </p>
          ) : null}
        </Reveal>
      ) : null}

      {/* FAQ — the product's own questions, as an accordion */}
      {faqItems.length > 0 ? (
        <Reveal>
          <section className="mt-10 rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8">
            <h2 className="font-display text-xl font-extrabold text-text-main">সাধারণ জিজ্ঞাসা</h2>
            <div className="mt-4 max-w-3xl space-y-2.5">
              {faqItems.map((item, i) => (
                <details
                  key={i}
                  className="group rounded-2xl border border-border px-4 transition duration-200 open:bg-surface-2/40 hover:border-brand-300"
                >
                  <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 py-2 text-[15px] font-semibold text-text-main [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-subtle transition duration-300 group-open:rotate-180"
                    >
                      ⌄
                    </span>
                  </summary>
                  <p className="break-words pb-4 leading-7 text-text-muted [overflow-wrap:anywhere]">{item.a}</p>
                </details>
              ))}
            </div>
          </section>
        </Reveal>
      ) : null}

      {/* Bundle contents (wave 15) — exactly what ships together.
          Component titles link to their own PDPs when the public
          shape carries the component slug. */}
      {productType === "BUNDLE" && bundleComponents.length > 0 ? (
        <Reveal>
        <section className="mt-10 rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8">
          <h2 className="font-display text-xl font-extrabold text-text-main">এই বান্ডলে যা যা আছে</h2>
          <ul className="mt-4 max-w-3xl divide-y divide-border">
            {bundleComponents.map((c, i) => {
              const title = c.productTitle?.bn ?? c.productTitle?.en ?? "";
              const linePrice =
                typeof c.unitPricePoisha === "number" ? c.unitPricePoisha * c.quantity : null;
              return (
                <li
                  key={`${c.variantId}-${i}`}
                  className="-mx-2 flex flex-wrap items-baseline justify-between gap-2 rounded-xl px-2 py-3 text-[15px] transition duration-200 first:pt-1 hover:bg-surface-2/60"
                >
                  <span className="min-w-0">
                    {c.productSlug && title ? (
                      <Link href={`/product/${c.productSlug}`} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
                        {title}
                      </Link>
                    ) : (
                      <span className="font-semibold text-text-main">{title || "কম্পোনেন্ট পণ্য"}</span>
                    )}
                    {c.variantLabel ? (
                      <span className="block text-xs text-text-subtle">{c.variantLabel}</span>
                    ) : c.sku ? (
                      <span className="block text-xs text-text-subtle">SKU: {c.sku}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-text-muted">
                    × <DigitText text={`${c.quantity}`} />
                    {linePrice !== null && !priceOnRequest ? (
                      <>
                        {" "}
                        —{" "}
                        <BdtAmount poisha={linePrice} className="font-semibold tabular-nums" />
                      </>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {bundleComponentsTotal !== null && !priceOnRequest ? (
            <p className="mt-4 max-w-3xl rounded-2xl bg-surface-2/60 px-4 py-3 text-sm leading-relaxed text-text-muted">
              আলাদা করে কিনলে মোট:{" "}
              <BdtAmount poisha={bundleComponentsTotal} className="font-semibold tabular-nums" /> — বান্ডল
              দাম:{" "}
              <BdtAmount poisha={minPrice} className="font-semibold tabular-nums text-brand-700 dark:text-brand-300" />
              {bundleComponentsTotal > minPrice ? (
                <>
                  {" "}
                  (সাশ্রয়{" "}
                  <BdtAmount
                    poisha={bundleComponentsTotal - minPrice}
                    className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400"
                  />
                  )
                </>
              ) : null}
            </p>
          ) : null}
          {bundleUnavailable ? (
            <p className="mt-3 max-w-3xl text-sm font-medium text-rose-600 dark:text-rose-400">
              আপাতত বান্ডলটি স্টকে নেই — কম্পোনেন্টগুলো আলাদাভাবে কিনতে উপরের লিংকগুলো দেখুন।
            </p>
          ) : null}
        </section>
        </Reveal>
      ) : null}

      {/* Customer reviews — real APPROVED rows from the Review table
          + the moderated submission form (src/reviews). */}
      <ReviewSection productId={product.id} productSlug={product.slug} />

      {/* Product Q&A — ANSWERED questions only + ask form for
          signed-in customers (src/qa). */}
      <QuestionsSection productId={product.id} productSlug={product.slug} />

      {/* Related products — manual picks first, same-category fill.
          Wave 17: on phones the rail is a snap-scroll carousel that
          bleeds to the screen edge; from sm up it is the usual grid. */}
      {related.length > 0 ? (
        <Reveal>
          <section className="mt-12">
            <div className="flex items-center gap-4">
              <h2 className="shrink-0 font-display text-xl font-extrabold text-text-main sm:text-2xl">সম্পর্কিত পণ্য</h2>
              <span aria-hidden="true" className="brand-gradient h-px flex-1 rounded-full opacity-40" />
            </div>
            <div className="-mx-4 mt-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:grid sm:snap-none sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-4 xl:gap-4">
              {related.map((p) => (
                <div
                  key={p.id}
                  className="w-[62vw] max-w-[230px] shrink-0 snap-start sm:w-auto sm:max-w-none"
                >
                  <ProductCard product={p} />
                </div>
              ))}
            </div>
          </section>
        </Reveal>
      ) : null}

      <RecentlyViewedRail excludeProductId={product.id} />
      {/* Sticky bar hidden for price-on-request products (it shows a price). */}
      {priceOnRequest ? null : (
        <StickyBuyBar titleBn={product.title.bn} pricePoisha={minPrice} inStock={displayInStock} buyBoxId="buy-box" />
      )}
      <CompareTray />
    </main>
  );
}
