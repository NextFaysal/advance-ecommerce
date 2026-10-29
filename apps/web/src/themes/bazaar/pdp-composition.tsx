/**
 * Bazaar PdpComposition slot — doc 24 wave T5 / doc 25 wave S4b.
 *
 * The grocery PDP: one large white rounded shadowed container on
 * the pale listing background, two columns on desktop — gallery
 * (vertical thumb rail + big bordered image) left; title, price,
 * quantity and the 2×2 action grid right. Below the container:
 * Description / Customer Reviews tabs, then the platform sections
 * (recent orders, course outline, specs, size chart, FAQ, bundle
 * contents, related products, recently viewed) and the mobile
 * sticky buy bar.
 *
 * The page (app/(store)/product/[slug]/page.tsx) keeps ALL data
 * fetching and derivation; this composition only arranges the
 * props it is handed (PdpCompositionProps — the same derived
 * values Aurora renders), exactly like aurora/pdp-composition.tsx.
 * Every annotation block Aurora renders (weighted info, EMI,
 * subscription/box CTAs, POD note, course outline, size chart,
 * age gate, preorder, digital/bundle notices) renders here too,
 * driven by the same props — only the frame changes.
 *
 * Purchasing parity: the buy area is BazaarPdpBuySection, which
 * mirrors BuyBoxActions' state machine over the same
 * addItemToGuestCart helper (see that file). WhatsApp/Call order
 * buttons need a store number; the platform exposes NO public
 * storefront number today, so the composition passes none and the
 * two buttons are omitted (never invented) — see pdp-actions.tsx.
 *
 * Route-local blocks (Gallery is replaced by this package's own
 * BazaarPdpGallery per doc 24 T5; SpinViewer, SizeChart, AgeGate,
 * DescriptionSection, ProductVideo) are imported from the route
 * directory by relative path, as Aurora's composition does.
 */
import Link from "next/link";
import { formatBdt, fromPoisha } from "@advance-ecommerce/validators";
import { getStoreDefaultLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import { BAZAAR_STRINGS, type BazaarStrings } from "./strings";
import { renderDescriptionHtml } from "@/catalog/description";
import { formatFileSize } from "@/catalog/product-type-contract";
import { WishlistToggleButton } from "@/catalog/WishlistToggleButton";
import { CompareToggleButton, CompareTray } from "@/storefront-ux/components/CompareTray";
import { BackInStockForm } from "@/storefront-ux/components/BackInStockForm";
import { StickyBuyBar } from "@/storefront-ux/components/StickyBuyBar";
import {
  RecordRecentlyViewedLazy,
  RecentlyViewedRailLazy,
} from "@/storefront-ux/components/RecentlyViewedLazy";
import { RecentOrdersSection } from "@/marketing/components/RecentOrdersSection";
import { EmiNote } from "@/marketing/components/EmiNote";
import { SubscribeSaveSection } from "@/subscriptions/subscribe-save-section";
import { BoxSubscribeSection } from "@/boxes/box-subscribe-section";
import { CourseOutlineSection } from "@/courses/course-outline-section";
import { ReviewSection } from "@/reviews/components/ReviewSection";
import { QuestionsSection } from "@/qa/components/QuestionsSection";
import { BdtAmount, DigitText } from "@/components/ui/numerals";
import { Reveal } from "@/components/ui/reveal";
import { ThemedProductCard } from "../themed-product-card";
import type { PdpCompositionProps } from "../slots";
import { SpinViewer } from "../../../app/(store)/product/[slug]/SpinViewer";
import { DescriptionSection } from "../../../app/(store)/product/[slug]/DescriptionSection";
import { ProductVideo } from "../../../app/(store)/product/[slug]/ProductVideo";
import { SizeChartButton, SizeChartSection } from "../../../app/(store)/product/[slug]/SizeChart";
import { AgeGate } from "../../../app/(store)/product/[slug]/AgeGate";
import BazaarPdpGallery from "./pdp-gallery";
import BazaarPdpBuySection from "./pdp-buy-section";
import BazaarPdpTabs from "./pdp-tabs";

/* Compact trust rows under the buy box (our own copy, same
   promises the platform makes everywhere — text from the theme
   dictionary, doc 30). */
function trustRows(s: BazaarStrings) {
  return [
    { icon: "🚚", text: s.trustFastDelivery },
    { icon: "💵", text: s.trustCodRow },
    { icon: "↩️", text: s.trustEasyReturn },
    { icon: "🛡️", text: s.trustGenuine },
  ];
}

function StarRow({ rating }: { rating: number }) {
  return (
    <span aria-hidden="true" className="text-[#F59E0B]">
      {Array.from({ length: 5 }, (_, i) => (
        <svg
          key={i}
          className={`inline h-4 w-4 ${i < Math.round(rating) ? "opacity-100" : "opacity-25"}`}
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.2 5.8 20.9l1.6-7L2 9.2l7.1-.6L12 2z" />
        </svg>
      ))}
    </span>
  );
}

export default async function BazaarPdpComposition({
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
  const locale = await getStoreDefaultLocale();
  const s = pick(locale, BAZAAR_STRINGS);
  // Merchant data with bn/en variants renders in the active locale;
  // the other variant stays as the small subtitle (the PDP's design).
  const title = product.title[locale] || product.title.bn;
  const titleAlt = locale === "bn" ? product.title.en : product.title.bn;
  const TRUST_ROWS = trustRows(s);
  return (
    <main className="bg-surface-2">
      <RecordRecentlyViewedLazy entry={recentlyViewedEntry} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="mx-auto min-w-0 max-w-[1440px] px-4 py-5 sm:px-6 lg:py-7">
        {/* Breadcrumb */}
        <nav
          aria-label={s.breadcrumbAria}
          className="flex flex-wrap items-center gap-1.5 text-sm text-text-subtle"
        >
          <Link href="/" className="py-1 transition hover:text-primary">{s.homeCrumb}</Link>
          <span aria-hidden="true" className="text-border">/</span>
          <Link href="/shop" className="py-1 transition hover:text-primary">{s.shopCrumb}</Link>
          <span aria-hidden="true" className="text-border">/</span>
          <Link
            href={`/shop?category=${product.categorySlug}`}
            className="py-1 transition hover:text-primary"
          >
            {product.categoryName[locale] || product.categoryName.bn}
          </Link>
          <span aria-hidden="true" className="text-border">/</span>
          <span className="min-w-0 truncate py-1 font-medium text-text-main">{title}</span>
        </nav>

        {/* ============ The white PDP container ============ */}
        <div className="mt-4 rounded-lg border border-border bg-card p-4 shadow-card sm:p-6 lg:p-8">
          <div className="grid gap-8 lg:grid-cols-2">
            {/* ---------- LEFT: gallery ---------- */}
            <div className="min-w-0">
              <BazaarPdpGallery
                images={product.images.map((img) => ({ url: img.url, altBn: img.altBn, altEn: img.altEn }))}
                titleBn={product.title.bn}
                titleEn={product.title.en}
              />
              {product.videoUrl ? (
                <div className="mt-4">
                  <ProductVideo videoUrl={product.videoUrl} titleBn={title} />
                </div>
              ) : null}
              {spinEnabled ? (
                <div className="mt-4">
                  <SpinViewer
                    images={product.images.map((img) => img.url)}
                    title={title}
                  />
                </div>
              ) : null}
            </div>

            {/* ---------- RIGHT: buy column ---------- */}
            <div className="min-w-0">
              {productType === "PREORDER" && preorder ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1 text-xs font-bold text-warning">
                  {s.preorderBadge}
                </span>
              ) : null}
              <h1 className="mt-2 break-words font-display text-[26px] font-extrabold leading-snug text-text-main [overflow-wrap:anywhere] sm:text-[32px]">
                {title}
              </h1>
              {titleAlt && titleAlt !== title ? (
                <p className="mt-1 break-words text-[15px] text-text-subtle">{titleAlt}</p>
              ) : null}

              {/* Meta row: rating · brand · stock */}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                <span className="flex items-center gap-1.5">
                  <StarRow rating={product.ratingAverage ?? 0} />
                  <span className="font-semibold text-text-main">
                    {product.ratingAverage ?? "—"}
                  </span>
                  <span className="text-text-subtle">
                    (<DigitText text={interpolate(s.reviewsCount, { count: product.reviewCount })} />)
                  </span>
                </span>
                {product.brandName ? (
                  <span className="text-text-muted">
                    {s.brandLabel} <span className="font-semibold text-text-main">{product.brandName}</span>
                  </span>
                ) : null}
                <span
                  className={`inline-flex items-center gap-1.5 font-semibold ${
                    displayInStock ? "text-success" : "text-destructive"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full ${displayInStock ? "bg-success" : "bg-destructive"}`}
                  />
                  {displayInStock ? s.inStock : s.outOfStock}
                </span>
              </div>

              {/* Variant info chips — informational (the buy
                  section below owns the actual selection) */}
              <div className="mt-4 flex flex-wrap gap-2">
                {product.variants
                  .filter((v) => v.isActive)
                  .map((v) => {
                    const label = Object.values(v.attributes).filter(Boolean).join(" · ") || v.sku;
                    return (
                      <span
                        key={v.id}
                        className="rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs font-medium text-text-muted"
                      >
                        {label} — <BdtAmount poisha={v.pricePoisha} />
                        {v.stock <= 0 ? s.soldOutSuffix : ""}
                      </span>
                    );
                  })}
              </div>

              {/* Price context line — the buy section re-renders the
                  SELECTED variant's price large; this line keeps
                  Aurora's range / best-discount context. */}
              {hasPriceRange ? (
                <p className="mt-4 text-sm text-text-muted">
                  {s.priceRangeLabel}{" "}
                  <span className="font-bold text-text-main">
                    <BdtAmount poisha={minPrice} /> – <BdtAmount poisha={maxPrice} />
                  </span>
                  {showDiscount ? (
                    <span className="ml-2 font-semibold text-success">
                      <DigitText text={interpolate(s.maxDiscount, { pct: discountPct })} />
                    </span>
                  ) : null}
                </p>
              ) : null}

              {/* Digital delivery notice */}
              {productType === "DIGITAL" ? (
                <div className="mt-4 rounded-lg border border-info/25 bg-info/10 px-4 py-3 text-sm leading-6 text-text-main">
                  <p className="font-bold">{s.digitalTitle}</p>
                  <p className="mt-0.5 text-text-muted">{s.digitalText}</p>
                  {digitalFiles.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-[13px] text-text-muted">
                      {digitalFiles.map((file, i) => (
                        <li key={`${file.fileName}-${i}`} className="flex flex-wrap gap-x-2">
                          <span className="font-medium text-text-main">{file.fileName}</span>
                          <span>({formatFileSize(file.sizeBytes)})</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {/* Pre-order terms — each line renders only when
                  the page actually derived that value. */}
              {productType === "PREORDER" && preorder ? (
                <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm leading-6 text-text-main">
                  <p className="font-bold">{s.preorderTermsTitle}</p>
                  <ul className="mt-1 space-y-0.5 text-text-muted">
                    {preorderExpectedLabel ? (
                      <li>{interpolate(s.expectedDelivery, { label: preorderExpectedLabel })}</li>
                    ) : null}
                    {preorder.depositPercent != null ? (
                      <li>
                        <DigitText
                          text={interpolate(s.preorderDeposit, { pct: preorder.depositPercent })}
                        />
                      </li>
                    ) : null}
                    {preorder.maxUnits != null ? (
                      <li>
                        <DigitText
                          text={interpolate(s.preorderMaxUnits, { count: preorder.maxUnits })}
                        />
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              {/* Bundle fully unavailable */}
              {productType === "BUNDLE" && bundleUnavailable ? (
                <p
                  role="alert"
                  className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive"
                >
                  {s.bundleUnavailableAlert}
                </p>
              ) : null}

              {/* The buy section — variant selection, quantity,
                  price and the 2×2 grid, over the platform's cart
                  write path (BazaarPdpBuySection). */}
              <div id="buy-box" className="mt-5 scroll-mt-32">
                {priceOnRequest ? (
                  <div className="rounded-lg border border-border bg-muted px-4 py-4">
                    <p className="font-display text-lg font-extrabold text-text-main">
                      {s.priceOnRequest}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-text-muted">
                      {s.priceOnRequestText}
                    </p>
                    <Link
                      href="/contact"
                      className="mt-3 inline-flex h-11 items-center rounded-md bg-primary px-5 text-sm font-bold text-white shadow-sm transition hover:opacity-90"
                    >
                      {s.contactButton}
                    </Link>
                  </div>
                ) : (
                  <AgeGate productId={product.id} minAge={ageMinAge}>
                    <BazaarPdpBuySection
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
                        ? { forceUnavailable: true, unavailableLabel: s.bundleUnavailableLabel }
                        : {})}
                      lowStockThreshold={lowStockThreshold}
                      {...(weightedInfos.length > 0
                        ? {
                            weightedSteps: Object.fromEntries(
                              weightedInfos.map((info) => [
                                info.variantId,
                                {
                                  stepQuantity:
                                    Math.max(
                                      1,
                                      Math.round((info.weightStepGrams * 1000) / info.packGrams),
                                    ) / 1000,
                                  packGrams: info.packGrams,
                                },
                              ]),
                            ),
                          }
                        : {})}
                    />
                  </AgeGate>
                )}

                {/* Print-on-demand disclosure (wave 56e) — a NOTE
                    only: the print text + colour are entered at
                    checkout, and this says so before the add. */}
                {podPdpNote ? (
                  <aside className="mt-4 rounded-lg border border-primary/25 bg-primary/10 px-4 py-3 text-sm leading-6 text-text-main">
                    <p className="font-bold">{s.podTitle}</p>
                    <p className="mt-0.5 text-text-muted">
                      {interpolate(s.podText, {
                        max: podPdpNote.textMaxChars,
                        colors: podPdpNote.hasColors ? s.podColorsSuffix : "",
                      })}
                      {podPdpNote.printFeePoisha > 0
                        ? interpolate(s.podFeeSuffix, { fee: fromPoisha(podPdpNote.printFeePoisha) })
                        : ""}
                    </p>
                  </aside>
                ) : null}
              </div>

              {/* EMI note (display-only) — hidden for
                  price-on-request, as in Aurora's composition. */}
              {priceOnRequest ? null : <EmiNote totalPoisha={minPrice} />}

              {/* Subscription boxes (wave 56d) / subscribe & save
                  (51) — self-gating sections, never both; hidden
                  for price-on-request like the EMI note. */}
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

              {/* Weighted-pricing info (ADV-22 grocery packs) —
                  the derived pack price is quoted ONLY when it
                  equals the recorded variant price (inSync). */}
              {weightedInfos.length > 0 && !priceOnRequest ? (
                <aside className="mt-4 rounded-lg border border-border bg-muted px-4 py-3 text-sm leading-6 text-text-main">
                  <p className="font-semibold">{s.weightedTitle}</p>
                  <ul className="mt-2 space-y-1.5 text-text-muted">
                    {weightedInfos.map((info) => {
                      const variant = product.variants.find((v) => v.id === info.variantId);
                      const label = variant
                        ? Object.values(variant.attributes).join(" / ") || info.sku
                        : info.sku;
                      return (
                        <li key={info.variantId}>
                          <span className="font-medium text-text-main">{label}</span>
                          {" — "}
                          <DigitText
                            text={interpolate(s.weightedPackLine, {
                              grams: info.packGrams,
                              price: formatBdt(info.pricePerKgPoisha),
                            })}
                          />
                          {info.inSync ? (
                            <DigitText
                              text={interpolate(s.weightedPackPrice, {
                                price: formatBdt(info.derivedPricePoisha),
                              })}
                            />
                          ) : (
                            <span className="text-text-subtle">{s.weightedOutdatedNote}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </aside>
              ) : null}

              {/* Wishlist / compare / size chart actions */}
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <WishlistToggleButton productId={product.id} />
                <CompareToggleButton productId={product.id} />
                {displaySizeChart ? <SizeChartButton chart={displaySizeChart} /> : null}
              </div>

              {/* Back-in-stock subscription (self-hides when empty) */}
              <BackInStockForm productId={product.id} variants={outOfStockVariants} />

              {/* Compact trust rows */}
              <ul className="mt-6 space-y-2 border-t border-border pt-4 text-[13px] leading-6 text-text-muted">
                {TRUST_ROWS.map((row) => (
                  <li key={row.text} className="flex items-start gap-2">
                    <span aria-hidden="true">{row.icon}</span>
                    <span>{row.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Recent real orders (flag-gated inside the component) */}
        <RecentOrdersSection />

        {/* ============ Tabs: Description / Customer Reviews ============ */}
        <BazaarPdpTabs
          description={
            product.description.bn ? (
              <DescriptionSection
                bnHtml={renderDescriptionHtml(product.description.bn)}
                enHtml={
                  product.description.en
                    ? renderDescriptionHtml(product.description.en)
                    : null
                }
              />
            ) : (
              <p className="mt-6 rounded-lg border border-dashed border-border bg-card px-5 py-6 text-sm text-text-muted">
                {s.descriptionMissing}
              </p>
            )
          }
          reviews={
            <div className="mt-6 space-y-6">
              <ReviewSection productId={product.id} productSlug={product.slug} />
              <QuestionsSection productId={product.id} productSlug={product.slug} />
            </div>
          }
        />

        {/* Course outline (wave 56f) — buyers get the player link */}
        {courseOutline ? (
          <div className="mt-8">
            <CourseOutlineSection outline={courseOutline} />
          </div>
        ) : null}

        {/* Specifications */}
        {specRows.length > 0 ? (
          <section className="mt-10 rounded-lg border border-border bg-card p-5 shadow-card sm:p-6">
            <h2 className="font-display text-lg font-extrabold text-text-main">{s.specificationsTitle}</h2>
            <span aria-hidden="true" className="mt-1.5 block h-[3px] w-8 rounded-full bg-primary" />
            <dl className="mt-4 divide-y divide-border">
              {specRows.map((row) => (
                <div key={row.key} className="grid grid-cols-[140px_1fr] gap-3 py-2.5 text-sm">
                  <dt className="font-semibold text-text-muted">{row.key}</dt>
                  <dd className="min-w-0 break-words text-text-main">{row.values.join(", ")}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {/* Size chart section */}
        {displaySizeChart ? (
          <div className="mt-8">
            <SizeChartSection chart={displaySizeChart} />
            {packSizeChart ? (
              <p className="mt-2 text-[13px] text-text-subtle">
                {s.sizeChartPackNote}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* FAQ */}
        {faqItems.length > 0 ? (
          <section className="mt-10 rounded-lg border border-border bg-card p-5 shadow-card sm:p-6">
            <h2 className="font-display text-lg font-extrabold text-text-main">
              {s.faqTitle}
            </h2>
            <span aria-hidden="true" className="mt-1.5 block h-[3px] w-8 rounded-full bg-primary" />
            <div className="mt-3 divide-y divide-border">
              {faqItems.map((item, i) => (
                <details key={i} className="group py-3">
                  <summary className="flex min-h-[32px] cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-semibold text-text-main [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span aria-hidden="true" className="text-primary transition group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-1.5 whitespace-pre-line text-sm leading-7 text-text-muted">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </section>
        ) : null}

        {/* Bundle contents */}
        {productType === "BUNDLE" && bundleComponents.length > 0 ? (
          <section className="mt-10 rounded-lg border border-border bg-card p-5 shadow-card sm:p-6">
            <h2 className="font-display text-lg font-extrabold text-text-main">
              {s.bundleContentsTitle}
            </h2>
            <span aria-hidden="true" className="mt-1.5 block h-[3px] w-8 rounded-full bg-primary" />
            <ul className="mt-3 divide-y divide-border">
              {bundleComponents.map((component, i) => {
                const title = component.productTitle?.bn ?? component.productTitle?.en ?? "";
                const linePrice =
                  typeof component.unitPricePoisha === "number"
                    ? component.unitPricePoisha * component.quantity
                    : null;
                return (
                  <li
                    key={`${component.variantId}-${i}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm"
                  >
                    <span className="min-w-0 flex-1">
                      {component.productSlug && title ? (
                        <Link
                          href={`/product/${component.productSlug}`}
                          className="font-semibold text-text-main transition hover:text-primary"
                        >
                          {title}
                        </Link>
                      ) : (
                        <span className="font-semibold text-text-main">
                          {title || s.componentProductFallback}
                        </span>
                      )}
                      {component.variantLabel ? (
                        <span className="block text-xs text-text-subtle">
                          {component.variantLabel}
                        </span>
                      ) : component.sku ? (
                        <span className="block text-xs text-text-subtle">
                          SKU: {component.sku}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-text-muted">
                      × <DigitText text={`${component.quantity}`} />
                    </span>
                    {linePrice !== null && !priceOnRequest ? (
                      <span className="font-semibold text-text-main">
                        <BdtAmount poisha={linePrice} />
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {bundleComponentsTotal !== null && !priceOnRequest ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
                <span className="text-text-muted">
                  {s.componentsTotalLabel} <BdtAmount poisha={bundleComponentsTotal} />
                </span>
                <span className="font-bold text-text-main">
                  {s.bundlePriceLabel} <BdtAmount poisha={minPrice} />
                  {bundleComponentsTotal > minPrice ? (
                    <span className="ml-2 font-semibold text-success">
                      <DigitText
                        text={interpolate(s.saveAmount, {
                          amount: formatBdt(bundleComponentsTotal - minPrice),
                        })}
                      />
                    </span>
                  ) : null}
                </span>
              </div>
            ) : null}
            {bundleUnavailable ? (
              <p className="mt-3 text-sm font-medium text-destructive">
                {s.bundleOutOfStockNote}
              </p>
            ) : null}
          </section>
        ) : null}

        {/* Related products */}
        {related.length > 0 ? (
          <Reveal>
            <section className="mt-12" aria-label={s.relatedAria}>
              <div>
                <h2 className="font-display text-xl font-extrabold text-text-main sm:text-2xl">
                  {s.relatedTitle}
                </h2>
                <span aria-hidden="true" className="mt-1.5 block h-[3px] w-10 rounded-full bg-primary" />
              </div>
              <div className="scrollbar-none -mx-4 mt-5 flex snap-x gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0">
                {related.map((p) => (
                  <div
                    key={p.id}
                    className="w-[62vw] max-w-[230px] shrink-0 snap-start sm:w-[240px] sm:max-w-none lg:w-auto"
                  >
                    <ThemedProductCard product={p} />
                  </div>
                ))}
              </div>
            </section>
          </Reveal>
        ) : null}

        {/* Recently viewed */}
        <RecentlyViewedRailLazy excludeProductId={product.id} />
      </div>

      {/* Mobile sticky buy bar — same component + behaviour as
          Aurora (purchasing parity). Suppressed for price-on-request
          (no price to show), as in Aurora's composition. */}
      {priceOnRequest ? null : (
        <StickyBuyBar
          titleBn={title}
          pricePoisha={minPrice}
          inStock={displayInStock}
          buyBoxId="buy-box"
        />
      )}
      <CompareTray />
    </main>
  );
}
