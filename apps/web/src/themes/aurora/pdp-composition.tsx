/**
 * Aurora PdpComposition slot — doc 25 §1.4 / wave S3b.
 *
 * The product page's arrangement, MOVED VERBATIM from
 * app/(store)/product/[slug]/page.tsx: same markup, same section
 * order (breadcrumb → gallery/buy-box grid → recent orders →
 * description → course outline → specs → size chart → FAQ → bundle
 * → reviews → Q&A → related rail → recently viewed → sticky buy
 * bar), same classes, same conditionals. The page keeps ALL data
 * fetching and every derived display value (see PdpCompositionProps
 * in src/themes/slots.ts) and passes them in; this component only
 * places them. Nothing here fetches or derives.
 *
 * The route-local building blocks (Gallery, SpinViewer, …) are
 * imported by relative path — they live beside the page and have no
 * src/ equivalents. The related-products rail renders the themed
 * ProductCard slot wrapper (S3b), like every other card consumer.
 *
 * Doc 32 refresh (P1/P2): the Gallery import is now a thin adapter
 * over the shared GalleryCore (StoreImage frames, priority first
 * image), the price cluster renders through the shared
 * PdpPriceBlock, the route gained a PdpSkeleton loading state, and
 * the below-fold sections share one Reveal rhythm. This file is
 * the reference implementation the other compositions are held to.
 */
import Link from "next/link";
import { fromPoisha } from "@advance-ecommerce/validators";
import { EmiNote } from "@/marketing/components/EmiNote";
import { RecentOrdersSection } from "@/marketing/components/RecentOrdersSection";
import { SubscribeSaveSection } from "@/subscriptions/subscribe-save-section";
import { BoxSubscribeSection } from "@/boxes/box-subscribe-section";
import { CourseOutlineSection } from "@/courses/course-outline-section";
import {
  RecordRecentlyViewedLazy,
  RecentlyViewedRailLazy,
} from "@/storefront-ux/components/RecentlyViewedLazy";
import { StickyBuyBar } from "@/storefront-ux/components/StickyBuyBar";
import { CompareToggleButton, CompareTray } from "@/storefront-ux/components/CompareTray";
import { BackInStockForm } from "@/storefront-ux/components/BackInStockForm";
import { BuyBoxActions } from "@/cart/components/BuyBoxActions";
import { PdpPriceBlock } from "@/storefront-ux/components/PriceBlock";
import { WishlistToggleButton } from "@/catalog/WishlistToggleButton";
import { renderDescriptionHtml } from "@/catalog/description";
import { formatFileSize } from "@/catalog/product-type-contract";
import { BdtAmount, DigitText } from "@/components/ui/numerals";
import { Reveal } from "@/components/ui/reveal";
import { ReviewSection } from "@/reviews/components/ReviewSection";
import { QuestionsSection } from "@/qa/components/QuestionsSection";
import { ThemedProductCard } from "../themed-product-card";
import type { PdpCompositionProps } from "../slots";
import { COMMON_STRINGS } from "@/i18n/dictionaries";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import { AURORA_STRINGS } from "./strings";
import { Gallery } from "../../../app/(store)/product/[slug]/Gallery";
import { SpinViewer } from "../../../app/(store)/product/[slug]/SpinViewer";
import { DescriptionSection } from "../../../app/(store)/product/[slug]/DescriptionSection";
import { ProductVideo } from "../../../app/(store)/product/[slug]/ProductVideo";
import { SizeChartButton, SizeChartSection } from "../../../app/(store)/product/[slug]/SizeChart";
import { AgeGate } from "../../../app/(store)/product/[slug]/AgeGate";

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

// Trust-row texts live in AURORA_STRINGS (trustPdpCod / trustPdpDelivery
// / trustPdpReturn / trustPdpOriginal — doc 30); only the icons stay here.
const TRUST_ICONS = [
  (
    <svg {...trustIconProps}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 9.5h.01M18 14.5h.01" />
    </svg>
  ),
  (
    <svg {...trustIconProps}>
      <path d="M2.5 6h12v11h-12z" />
      <path d="M14.5 10h3.6l3 3.4V17h-6.6" />
      <circle cx="6.5" cy="17.5" r="1.8" />
      <circle cx="17.5" cy="17.5" r="1.8" />
    </svg>
  ),
  (
    <svg {...trustIconProps}>
      <path d="M8.5 5.5 5 9l3.5 3.5" />
      <path d="M5 9h9a5 5 0 0 1 0 10h-3" />
    </svg>
  ),
  (
    <svg {...trustIconProps}>
      <path d="M12 3l7 2.8v5.4c0 4.6-3 7.7-7 9.3-4-1.6-7-4.7-7-9.3V5.8L12 3z" />
      <path d="M9 11.6l2.2 2.2L15.4 9.6" />
    </svg>
  ),
] as const;

export default async function AuroraPdpComposition({
  product,
  productType,
  digitalFiles,
  bundleComponents,
  preorder,
  preorderExpectedLabel,
  priceOnRequest,
  minPrice,
  maxPrice,
  hasPriceRange,
  showDiscount,
  bestDiscount,
  discountPct,
  displayInStock,
  bundleUnavailable,
  bundleCount,
  bundleComponentsTotal,
  lowStockThreshold,
  spinEnabled,
  ageMinAge,
  weightedInfos,
  boxPdpData,
  podPdpNote,
  courseOutline,
  displaySizeChart,
  packSizeChart,
  specRows,
  faqItems,
  outOfStockVariants,
  related,
  recentlyViewedEntry,
  jsonLd,
}: PdpCompositionProps) {
  const locale = await getRequestLocale();
  const t = pick(locale, COMMON_STRINGS);
  const s = pick(locale, AURORA_STRINGS);
  // Merchant data with bn/en variants renders in the active locale;
  // the other variant stays as the small subtitle (the PDP's design).
  const title = product.title[locale] || product.title.bn;
  const titleAlt = locale === "bn" ? product.title.en : product.title.bn;
  const trustTexts = [s.trustPdpCod, s.trustPdpDelivery, s.trustPdpReturn, s.trustPdpOriginal];
  return (
    <main className="mx-auto min-w-0 max-w-[1440px] px-4 py-6 sm:px-6 lg:py-8">
      <RecordRecentlyViewedLazy entry={recentlyViewedEntry} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Breadcrumb */}
      <nav aria-label={s.breadcrumbAria} className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-text-subtle">
        <Link href="/" className="py-1 transition hover:text-brand-700 dark:hover:text-brand-300">{t.home}</Link>
        <span aria-hidden="true" className="text-border">/</span>
        <Link href="/shop" className="py-1 transition hover:text-brand-700 dark:hover:text-brand-300">{s.shopBreadcrumb}</Link>
        <span aria-hidden="true" className="text-border">/</span>
        <Link href={`/shop?category=${product.categorySlug}`} className="py-1 transition hover:text-brand-700 dark:hover:text-brand-300">
          {product.categoryName[locale] || product.categoryName.bn}
        </Link>
        <span aria-hidden="true" className="text-border">/</span>
        <span className="max-w-[45vw] truncate py-1 font-medium text-text-main">{title}</span>
      </nav>

      <div className="mt-5 grid items-start gap-8 lg:grid-cols-2">
        {/* Gallery + product video (gallery-adjacent, same column) */}
        <div className="min-w-0 space-y-4">
          <Gallery
            images={product.images.map((img) => ({ url: img.url, altBn: locale === "en" ? img.altEn || img.altBn : img.altBn }))}
            titleBn={title}
          />
          {product.videoUrl ? <ProductVideo videoUrl={product.videoUrl} titleBn={title} /> : null}
          {spinEnabled ? (
            <SpinViewer images={product.images.map((i) => i.url)} title={title} />
          ) : null}
        </div>

        {/* Buy box — sticky on desktop (offset clears the taller
            v3 header: main row + mega-menu row) */}
        <div className="min-w-0 lg:sticky lg:top-[8.5rem]">
          {productType === "PREORDER" ? (
            <span className="mb-3 inline-flex rounded-full bg-sky-600 px-3 py-1 text-xs font-bold text-white shadow-md">
              {s.preorderBadge}
            </span>
          ) : null}
          <h1 className="break-words font-display text-[clamp(1.625rem,3.5vw,2.125rem)] font-extrabold leading-[1.25] text-text-main [overflow-wrap:anywhere]">
            {title}
          </h1>
          {titleAlt && titleAlt !== title ? (
            <p className="mt-1.5 break-words text-sm text-text-subtle [overflow-wrap:anywhere]">{titleAlt}</p>
          ) : null}

          <p className="mt-4 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1.5 rounded-2xl bg-surface-2/70 px-3.5 py-2 text-sm text-text-muted">
            <StarRow rating={product.ratingAverage ?? 0} />
            <span aria-label={interpolate(s.ratingAria, { rating: product.ratingAverage ?? "—" })}>
              {product.ratingAverage ?? "—"} {interpolate(s.reviewsCount, { count: product.reviewCount })}
            </span>
            {product.brandName ? (
              <>
                <span aria-hidden="true" className="text-border">•</span>
                <span>
                  {s.brandLabel} <span className="font-semibold text-text-main">{product.brandName}</span>
                </span>
              </>
            ) : null}
            <span aria-hidden="true" className="text-border">•</span>
            <span className={`font-semibold ${displayInStock ? "text-success-solid" : "text-danger"}`}>
              {displayInStock ? t.inStock : t.outOfStock}
            </span>
          </p>

          <div className="relative mt-5 overflow-hidden rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
            {/* Aurora accent hairline — decorative top edge of the buy card */}
            <div aria-hidden="true" className="brand-gradient absolute inset-x-0 top-0 h-1" />
            {/* Price — or the price-on-request label (schema wave 2) */}
            {priceOnRequest ? (
              <p className="pt-1 font-display text-3xl font-extrabold text-brand-700 dark:text-brand-300">
                {s.contactForPrice}
              </p>
            ) : (
            /* Price cluster — the shared PdpPriceBlock (doc 32 P1);
               same markup this composition used to inline. */
            <PdpPriceBlock
              minPoisha={minPrice}
              maxPoisha={maxPrice}
              hasRange={hasPriceRange}
              compareAtPoisha={showDiscount && bestDiscount ? bestDiscount.compare : null}
              discountPct={showDiscount && bestDiscount ? discountPct : null}
              discountOffText={s.discountOff}
              className="pt-1"
            />
            )}

            {/* Variant list (info) — the buy box below owns selection.
                Prices are omitted for price-on-request products. */}
            <h2 className="mt-6 text-sm font-bold text-text-main">
              {priceOnRequest ? s.variantOnly : s.variantsAndPrice}
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
                    {Object.values(v.attributes).join(" / ") || s.standardVariant}
                    {priceOnRequest ? null : (
                      <>
                        {" "}—{" "}
                        <BdtAmount poisha={v.pricePoisha} className="font-semibold tabular-nums" />
                      </>
                    )}
                    {soldOut ? s.variantOutOfStock : ""}
                  </span>
                );
              })}
            </div>

            {/* Product-type notices (wave 15) — inside the buy card,
                right where the buying decision happens. */}
            {productType === "DIGITAL" ? (
              <div className="mt-6 rounded-2xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-400/25 dark:bg-violet-500/10">
                <p className="text-sm font-bold text-violet-900 dark:text-violet-100">
                  {s.digitalTitle}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-violet-800 dark:text-violet-200">
                  {s.digitalBody}
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
                <p className="font-bold">{s.preorderNoticeTitle}</p>
                {preorderExpectedLabel ? (
                  <p className="mt-1">
                    {s.expectedDelivery} <span className="font-semibold">{preorderExpectedLabel}</span>
                  </p>
                ) : null}
                {preorder?.depositPercent != null ? (
                  <p className="mt-1">
                    {s.preorderDepositPrefix}{" "}
                    <span className="font-semibold">
                      <DigitText text={`${preorder.depositPercent}%`} />
                    </span>{" "}
                    {s.preorderDepositSuffix}
                  </p>
                ) : null}
                {preorder?.maxUnits != null ? (
                  <p className="mt-1">
                    {s.preorderMaxPrefix} <DigitText text={`${preorder.maxUnits}`} />
                    {s.preorderMaxSuffix}
                  </p>
                ) : null}
              </div>
            ) : null}

            {productType === "BUNDLE" && bundleUnavailable ? (
              <p className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700 dark:border-rose-400/25 dark:bg-rose-500/10 dark:text-rose-200">
                {s.bundleUnavailableNotice}
              </p>
            ) : null}

            <div id="buy-box" className="mt-6 scroll-mt-32">
              {priceOnRequest ? (
                /* Price-on-request (schema wave 2): no cart, no
                   buy-now — the customer asks through the contact /
                   inbox path and staff quote a price there. */
                <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-400/25 dark:bg-brand-500/10">
                  <p className="text-sm font-bold text-brand-900 dark:text-brand-100">
                    {s.priceOnRequestTitle}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-brand-800 dark:text-brand-200">
                    {s.priceOnRequestBody}
                  </p>
                  <Link
                    href="/contact"
                    className="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    {s.contactForPrice}
                  </Link>
                </div>
              ) : (
              <>
              {/* Add-to-cart + buy-now (Agent 35): client variant picker +
                  quantity + guest-cart write via src/cart contracts.
                  ADV-29: wrapped in the age gate when this product's
                  category is age-restricted (minAge null = no gate). */}
              <AgeGate productId={product.id} minAge={ageMinAge}>
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
                  ? { ctaLabel: s.preorderCta, buyNowLabel: s.preorderBuyNow }
                  : {})}
                {...(bundleUnavailable
                  ? { forceUnavailable: true, unavailableLabel: s.bundleOutOfStockLabel }
                  : {})}
                lowStockThreshold={lowStockThreshold}
                {...(weightedInfos.length > 0
                  ? {
                      weightedSteps: Object.fromEntries(
                        weightedInfos.map((info) => [
                          info.variantId,
                          {
                            stepQuantity:
                              Math.max(1, Math.round((info.weightStepGrams * 1000) / info.packGrams)) / 1000,
                            packGrams: info.packGrams,
                          },
                        ]),
                      ),
                    }
                  : {})}
              />
              </AgeGate>
              {/* Custom print (ADV-23 vertical 5): a NOTE only —
                  the print text + colour are entered at checkout
                  (the guest cart carries no customisation), and
                  this says so before the customer adds to cart. */}
              {podPdpNote ? (
                <p className="mt-3 rounded-xl bg-surface-2 px-4 py-3 text-sm leading-6 text-text-muted">
                  🎨 <strong className="text-text-main">{s.podStrong}</strong> {s.podBodyStart}{" "}
                  {podPdpNote.textMaxChars} {s.podCharsUnit}
                  {podPdpNote.hasColors ? s.podColorsPart : ""}
                  {s.podBodyEnd}
                  {podPdpNote.printFeePoisha > 0
                    ? interpolate(s.podFee, { fee: fromPoisha(podPdpNote.printFeePoisha) })
                    : ""}
                </p>
              ) : null}
              </>
              )}
            </div>

            {/* EMI breakdown (ADV-18B) — display-only bank-card terms
                at the product's lowest variant price; self-gating.
                Hidden for price-on-request products (no price shown). */}
            {priceOnRequest ? null : <EmiNote totalPoisha={minPrice} />}

            {/* Subscribe & save (ADV-18 remainder) — self-gating
                server section: renders nothing while the
                module.subscriptions flag is OFF. Hidden for
                price-on-request products like the EMI note.
                ADV-23 vertical 4: a listed BOX product gets the box
                section instead (cycle choice + announced contents) —
                never both cards stacked. */}
            {priceOnRequest ? null : boxPdpData !== null ? (
              <BoxSubscribeSection
                variants={product.variants.map((v) => ({
                  id: v.id,
                  label: Object.values(v.attributes).join(" / ") || s.standardVariant,
                  pricePoisha: v.pricePoisha,
                  stock: v.stock,
                }))}
                data={boxPdpData}
              />
            ) : (
              <SubscribeSaveSection
                variants={product.variants.map((v) => ({
                  id: v.id,
                  label: Object.values(v.attributes).join(" / ") || s.standardVariant,
                  pricePoisha: v.pricePoisha,
                  stock: v.stock,
                }))}
              />
            )}

            {/* ADV-22 (grocery pack): weighted products sell as fixed
                weight packs priced from a per-kg rate. The annotation
                states the rate + pack weight; the derived pack price
                is quoted ONLY when it equals the recorded variant
                price (inSync) — a rate edited since the last admin
                price sync is never presented as the current price.
                Hidden entirely for price-on-request products. */}
            {weightedInfos.length > 0 && !priceOnRequest ? (
              <div className="mt-4 rounded-2xl border border-border bg-surface-2/60 p-4 text-sm leading-6">
                <p className="font-semibold text-text-main">{s.weightedTitle}</p>
                <ul className="mt-2 space-y-1.5 text-text-muted">
                  {weightedInfos.map((info) => {
                    const variant = product.variants.find((v) => v.id === info.variantId);
                    const label = variant
                      ? Object.values(variant.attributes).join(" / ") || info.sku
                      : info.sku;
                    return (
                      <li key={info.variantId}>
                        <span className="font-medium text-text-main">{label}</span>
                        {" — "}{s.packLabel} <DigitText text={`${info.packGrams}`} /> {s.gramsUnit} · {s.perKgLabel}{" "}
                        <BdtAmount poisha={info.pricePerKgPoisha} />
                        {info.inSync ? (
                          <>
                            {" "}· {s.packPriceLabel} <BdtAmount poisha={info.derivedPricePoisha} />
                          </>
                        ) : (
                          <span className="text-text-subtle">
                            {" "}· {s.weightedOutOfSync}
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
              {TRUST_ICONS.map((icon, i) => (
                <li key={trustTexts[i]} className="flex items-center gap-3 rounded-2xl bg-surface-2/60 p-3 text-sm leading-snug text-text-muted">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
                    {icon}
                  </span>
                  {trustTexts[i]}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Recent orders (doc 23 wave 60, honest social proof) —
          self-gating: renders only while module.social_proof is
          on, and the ticker itself stays silent until >= 3 REAL
          recent store orders come back from its API. */}
      <RecentOrdersSection />

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

      {/* Course outline (ADV-23 vertical 6) — titles only, public;
          lesson bodies live behind the account player + the
          order-derived access check. */}
      {courseOutline ? (
        <Reveal>
          <CourseOutlineSection outline={courseOutline} />
        </Reveal>
      ) : null}

      {/* Specification — union of variant attributes */}
      {specRows.length > 0 ? (
        <Reveal>
          <section className="mt-10 rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8">
            <h2 className="font-display text-xl font-extrabold text-text-main">{s.specifications}</h2>
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
              <span className="font-semibold text-text-main">{s.fitNoteLabel} </span>
              {locale === "bn"
                ? (packSizeChart.fitNoteBn ?? packSizeChart.fitNoteEn)
                : (packSizeChart.fitNoteEn ?? packSizeChart.fitNoteBn)}
            </p>
          ) : null}
        </Reveal>
      ) : null}

      {/* FAQ — the product's own questions, as an accordion */}
      {faqItems.length > 0 ? (
        <Reveal>
          <section className="mt-10 rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8">
            <h2 className="font-display text-xl font-extrabold text-text-main">{t.faq}</h2>
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
          <h2 className="font-display text-xl font-extrabold text-text-main">{s.bundleContentsTitle}</h2>
          <ul className="mt-4 max-w-3xl divide-y divide-border">
            {bundleComponents.map((c, i) => {
              const title = c.productTitle?.[locale] ?? c.productTitle?.bn ?? c.productTitle?.en ?? "";
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
                      <span className="font-semibold text-text-main">{title || s.componentProduct}</span>
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
              {s.bundleSeparateTotal}{" "}
              <BdtAmount poisha={bundleComponentsTotal} className="font-semibold tabular-nums" /> — {s.bundlePriceLabel}{" "}
              <BdtAmount poisha={minPrice} className="font-semibold tabular-nums text-brand-700 dark:text-brand-300" />
              {bundleComponentsTotal > minPrice ? (
                <>
                  {" "}
                  ({s.savingsLabel}{" "}
                  <BdtAmount
                    poisha={bundleComponentsTotal - minPrice}
                    className="font-semibold tabular-nums text-success-solid"
                  />
                  )
                </>
              ) : null}
            </p>
          ) : null}
          {bundleUnavailable ? (
            <p className="mt-3 max-w-3xl text-sm font-medium text-danger">
              {s.bundleUnavailableNote}
            </p>
          ) : null}
        </section>
        </Reveal>
      ) : null}

      {/* Customer reviews — real APPROVED rows from the Review table
          + the moderated submission form (src/reviews). Reveal
          wrapper matches the section rhythm of the blocks above
          (description / specs / FAQ / bundle — doc 32 P2). */}
      <Reveal>
        <ReviewSection productId={product.id} productSlug={product.slug} />
      </Reveal>

      {/* Product Q&A — ANSWERED questions only + ask form for
          signed-in customers (src/qa). */}
      <Reveal>
        <QuestionsSection productId={product.id} productSlug={product.slug} />
      </Reveal>

      {/* Related products — manual picks first, same-category fill.
          Wave 17: on phones the rail is a snap-scroll carousel that
          bleeds to the screen edge; from sm up it is the usual grid. */}
      {related.length > 0 ? (
        <Reveal>
          <section className="mt-12">
            <div className="flex items-center gap-4">
              <h2 className="shrink-0 font-display text-xl font-extrabold text-text-main sm:text-2xl">{s.relatedProducts}</h2>
              <span aria-hidden="true" className="brand-gradient h-px flex-1 rounded-full opacity-40" />
            </div>
            <div className="-mx-4 mt-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:grid sm:snap-none sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-4 xl:gap-4">
              {related.map((p) => (
                <div
                  key={p.id}
                  className="w-[62vw] max-w-[230px] shrink-0 snap-start sm:w-auto sm:max-w-none"
                >
                  <ThemedProductCard product={p} />
                </div>
              ))}
            </div>
          </section>
        </Reveal>
      ) : null}

      <RecentlyViewedRailLazy excludeProductId={product.id} />
      {/* Sticky bar hidden for price-on-request products (it shows a price). */}
      {priceOnRequest ? null : (
        <StickyBuyBar titleBn={title} pricePoisha={minPrice} inStock={displayInStock} buyBoxId="buy-box" />
      )}
      <CompareTray />
    </main>
  );
}
