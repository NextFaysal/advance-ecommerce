// Landing view renderer — Agent 53; doc-34 L1 locale + imagery pass.
// Server-friendly presentational component shared by the public
// /lp/[slug] page and the admin preview pane, so preview == public
// output. The buy CTA reuses the existing guest-cart helper via
// AddToCartButton (the same component ProductCard uses): clicking adds
// the offer variant to the guest cart; a second link goes to the
// product page. No new tracking code — the wrapper only carries
// data-product-* attributes for the existing tracking shell.
//
// Locale (doc 30, completed at this layer in doc 34 L1): the caller
// resolves the visitor's locale (server: getRequestLocale; builder:
// useLocale) and passes it in. Section copy picks its [locale] half
// with the bn fallback, and ALL chrome (stock labels, view-details,
// the form's labels) comes from the landing dictionary
// (src/landing/strings.ts) — before L1 this component rendered the
// Bangla half only, with hardcoded Bangla chrome literals.
//
// Imagery (audit gap #2): the hero renders its stored imageUrl and
// the offer card renders the product image — both through StoreImage
// (doc 32 presets). Sections without an image render no image element
// at all, so an image-less page's markup is exactly what it was.
//
// Design controls (doc 34 L4, §3.5): a section may carry an
// optional design object (background preset / vertical padding /
// device visibility / on-off), applied as a wrapper by
// applySectionDesign below. No design object ⇒ no wrapper and no
// class change — design-less markup stays exactly what it was.
import { Fragment, type ReactNode } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import { AddToCartButton } from "@/cart/components/AddToCartButton";
import { StoreImage } from "@/storefront-ux/components/StoreImage";
import { RAIL_FADE_CLASS } from "@/storefront-ux/responsive";
import { interpolate, pick, type Locale } from "@/i18n/locale";
import { LANDING_STRINGS, type LandingStrings } from "../strings";
import { CountdownNote } from "./CountdownNote";
import { QuickOrderForm, type QuickOrderFunnelContext } from "./QuickOrderForm";
import { RichText } from "./blocks/RichText";
import { VideoFacade } from "./blocks/VideoFacade";
import { LandingProductCard } from "./blocks/LandingProductCard";
import { ProductCarousel } from "./blocks/ProductCarousel";
import { CountdownBlock } from "./blocks/CountdownBlock";
import type { LandingViewModel, LandingViewSection, ResolvedOffer } from "../render";
import type { LandingSectionDesign } from "../types";

/** The doc-30 pair pick: the locale's half, Bangla when it is empty. */
function pair(locale: Locale, bn: string, en: string): string {
  return locale === "en" ? en || bn : bn;
}

/** product_grid column classes — static lookups so Tailwind's JIT
 *  always sees the full class names (never string-built). */
const GRID_COLS_MOBILE = { 1: "grid-cols-1", 2: "grid-cols-2" } as const;
const GRID_COLS_DESKTOP = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4" } as const;

function OfferBuy({
  offer,
  ctaLabel,
  s,
}: {
  offer: ResolvedOffer;
  ctaLabel?: string;
  s: LandingStrings;
}) {
  return (
    <div
      data-product-id={offer.productId}
      data-product-slug={offer.productSlug}
      data-variant-id={offer.variantId}
      className="flex flex-col gap-2"
    >
      <AddToCartButton
        productId={offer.productId}
        productTitleBn={offer.productTitleBn}
        variant={{
          variantId: offer.variantId,
          sku: offer.sku,
          unitPricePoisha: offer.pricePoisha,
          compareAtPoisha: offer.compareAtPoisha,
          stock: offer.stock,
          imageUrl: offer.imageUrl,
        }}
        labelBn={ctaLabel ?? s.defaultCta}
      />
      <a href={`/product/${offer.productSlug}`} className="text-center text-sm text-brand-600 underline">
        {s.viewDetails}
      </a>
    </div>
  );
}

/** Star row for a review rating (1–5): filled/empty glyphs, the
 *  numeric value carried in the aria-label via the dictionary. */
function Stars({ rating, s }: { rating: number; s: LandingStrings }) {
  const clamped = Math.min(5, Math.max(0, Math.round(rating)));
  return (
    <span role="img" aria-label={interpolate(s.ratingOf, { rating })} className="text-sm tracking-wide text-amber-500">
      {"★".repeat(clamped)}
      <span className="text-text-subtle">{"★".repeat(5 - clamped)}</span>
    </span>
  );
}

export function LandingView({
  view,
  locale = "bn",
  funnelForm,
}: {
  view: LandingViewModel;
  locale?: Locale;
  /** Doc 34 L7: the funnel runtime's order-step context — threaded
   *  to the page's QuickOrderForm only; absent everywhere else. */
  funnelForm?: QuickOrderFunnelContext;
}) {
  const s = pick(locale, LANDING_STRINGS);
  const hero = view.sections.find((sec) => sec.kind === "hero");
  const heroCta = hero ? pair(locale, hero.ctaLabelBn, hero.ctaLabelEn) : undefined;
  // The bundle block's scroll CTA targets the page's order form
  // (rendered with id="landing-order-form" below) when one exists.
  const hasQuickOrder = view.sections.some((sec) => sec.kind === "quick_order" && sec.product !== null);
  // The sticky bar's primary_offer target: the section that
  // resolved the page's primary offer gets the scroll anchor — but
  // ONLY when a bar on this page actually targets it, so pages
  // without such a bar render exactly as before.
  const primaryOfferSectionId = view.sections.find((sec) => sec.kind === "product_offer" && sec.offer !== null)?.id;
  const stickyTargetsOffer = view.sections.some((sec) => sec.kind === "sticky_bar" && sec.target === "primary_offer" && sec.offer !== null);
  const ctx: SectionRenderContext = { s, locale, heroCta, primaryOffer: view.primaryOffer, hasQuickOrder, stickyTargetsOffer, primaryOfferSectionId, funnelForm };
  return (
    <div className="mx-auto max-w-3xl">
      {view.sections.map((section) => {
        // Doc 34 L4 (§3.5): a section whose design disables it
        // renders nothing at all (it stays in the page data; the
        // builder's section list shows it dimmed). Everything else
        // passes through applySectionDesign — a strict no-op for
        // design-less sections, which is what keeps their
        // rendering byte-identical to before L4.
        if (section.design?.enabled === false) return null;
        return applySectionDesign(section, renderSection(section, ctx));
      })}
    </div>
  );
}

/** Everything the section switch reads from the page scope,
 *  bundled so the switch can live in renderSection below (it used
 *  to sit inline in the component's map callback). */
interface SectionRenderContext {
  s: LandingStrings;
  locale: Locale;
  heroCta: string | undefined;
  primaryOffer: ResolvedOffer | null;
  hasQuickOrder: boolean;
  stickyTargetsOffer: boolean;
  primaryOfferSectionId: string | undefined;
  /** Doc 34 L7: funnel order-step context (claims + bump card),
   *  set ONLY by the funnel runtime — /lp and the admin preview
   *  never pass it, so their forms render exactly as before. */
  funnelForm: QuickOrderFunnelContext | undefined;
}

/** Design preset → wrapper classes (doc 34 §3.5). Static lookups
 *  only — Tailwind's JIT must see every class name literally.
 *  Token surfaces throughout, so a painted band flips with the
 *  active theme's tokens (incl. dark) like any other surface. */
const DESIGN_BG_CLASS: Record<NonNullable<LandingSectionDesign["bg"]>, string> = {
  none: "",
  card: "bg-card",
  surface: "bg-surface-2",
  brand: "brand-gradient text-white",
  dark: "bg-overlay text-white",
};
const DESIGN_PADDING_CLASS: Record<NonNullable<LandingSectionDesign["paddingY"]>, string> = {
  sm: "py-3",
  md: "py-6",
  lg: "py-10",
};

/**
 * Apply a section's design object (doc 34 §3.5, L4) around its
 * rendered node. THE byte-identical guarantee lives here: a
 * section with NO design object returns its node untouched — no
 * wrapper element, no class change — so design-less pages render
 * exactly as before L4. A design resolving to no classes (e.g.
 * only `enabled: true`, or bg "none" alone) is likewise returned
 * unwrapped. Sections that render null (empty reviews / gallery /
 * unresolved countdown…) are never wrapped, so a painted band
 * never appears around nothing. An out-of-enum preset value
 * (impossible through the API's Zod gate; conceivable in a
 * hand-edited row) misses the lookup and degrades to no class.
 */
function applySectionDesign(section: LandingViewSection, node: ReactNode): ReactNode {
  const design = section.design;
  if (!design || node === null) return node;
  const className = [
    design.bg ? DESIGN_BG_CLASS[design.bg] ?? "" : "",
    design.paddingY ? DESIGN_PADDING_CLASS[design.paddingY] ?? "" : "",
    design.hiddenOn === "mobile" ? "hidden lg:block" : design.hiddenOn === "desktop" ? "lg:hidden" : "",
  ]
    .filter(Boolean)
    .join(" ");
  if (!className) return node;
  return (
    <div key={section.id} className={className}>
      {node}
    </div>
  );
}

function renderSection(section: LandingViewSection, ctx: SectionRenderContext): ReactNode {
  const { s, locale, heroCta, primaryOffer, hasQuickOrder, stickyTargetsOffer, primaryOfferSectionId } = ctx;
  switch (section.kind) {
    case "hero":
      return (
        <section key={section.id} className="brand-gradient rounded-b-2xl px-5 py-10 text-center text-white">
          {section.imageUrl ? (
            <div className="mx-auto mb-6 max-w-xl">
              <StoreImage
                src={section.imageUrl}
                preset="hero"
                priority
                alt={pair(locale, section.titleBn, section.titleEn)}
                className="rounded-xl"
              />
            </div>
          ) : null}
          <h1 className="text-3xl font-bold leading-snug">{pair(locale, section.titleBn, section.titleEn)}</h1>
          {pair(locale, section.subtitleBn, section.subtitleEn) ? (
            <p className="mx-auto mt-3 max-w-xl leading-7">{pair(locale, section.subtitleBn, section.subtitleEn)}</p>
          ) : null}
          {primaryOffer ? (
            <div className="mx-auto mt-6 max-w-xs rounded-xl bg-white/95 p-3 text-left">
              <OfferBuy offer={primaryOffer} ctaLabel={pair(locale, section.ctaLabelBn, section.ctaLabelEn)} s={s} />
            </div>
          ) : null}
        </section>
      );
    case "product_offer":
      if (!section.offer) {
        return (
          <section key={section.id} className="px-5 py-6 text-center text-sm text-text-muted">
            {s.offerUnavailable}
          </section>
        );
      }
      return (
        <section
          key={section.id}
          id={stickyTargetsOffer && section.id === primaryOfferSectionId ? "landing-primary-offer" : undefined}
          className={stickyTargetsOffer && section.id === primaryOfferSectionId ? "scroll-mt-4 px-5 py-8" : "px-5 py-8"}
        >
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            {section.offer.imageUrl ? (
              <StoreImage
                src={section.offer.imageUrl}
                preset="card"
                alt={pair(locale, section.offer.productTitleBn, section.offer.productTitleEn)}
                className="mb-4 rounded-xl"
              />
            ) : null}
            <h2 className="text-xl font-bold">{pair(locale, section.offer.productTitleBn, section.offer.productTitleEn)}</h2>
            <p className="text-sm text-text-muted">{section.offer.variantLabel || s.standardVariant}</p>
            <p className="mt-3 flex flex-wrap items-baseline gap-2">
              <span className="text-3xl font-bold text-brand-600">{formatBdt(section.offer.pricePoisha)}</span>
              {section.offer.compareAtPoisha && section.offer.compareAtPoisha > section.offer.pricePoisha ? (
                <span className="text-lg text-text-muted line-through">{formatBdt(section.offer.compareAtPoisha)}</span>
              ) : null}
            </p>
            {pair(locale, section.discountNoteBn, section.discountNoteEn) ? (
              <p className="mt-1 text-sm text-success-solid">{pair(locale, section.discountNoteBn, section.discountNoteEn)}</p>
            ) : null}
            {section.showCountdown && section.countdownEndsAt ? (
              <CountdownNote endsAt={section.countdownEndsAt} locale={locale} />
            ) : null}
            <p className="mt-2 text-sm">
              {section.offer.inStock ? interpolate(s.inStockCount, { count: section.offer.stock }) : s.outOfStock}
            </p>
            <div className="mt-4 max-w-xs">
              <OfferBuy offer={section.offer} ctaLabel={heroCta} s={s} />
            </div>
          </div>
        </section>
      );
    case "benefits":
      return (
        <section key={section.id} className="px-5 py-6">
          <h2 className="text-xl font-bold">{pair(locale, section.headingBn, section.headingEn)}</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {section.items.map((item, i) => (
              <li key={i} className="flex items-start gap-2 rounded-xl bg-surface-2 p-3">
                <span aria-hidden="true">{item.icon}</span>
                <span className="leading-7">{pair(locale, item.textBn, item.textEn)}</span>
              </li>
            ))}
          </ul>
        </section>
      );
    case "how_to_order":
      return (
        <section key={section.id} className="px-5 py-6">
          <h2 className="text-xl font-bold">{pair(locale, section.headingBn, section.headingEn)}</h2>
          <ol className="mt-3 space-y-2">
            {section.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3 leading-7">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 font-bold text-white">{i + 1}</span>
                <span>{pair(locale, step.textBn, step.textEn)}</span>
              </li>
            ))}
          </ol>
        </section>
      );
    case "faq":
      return (
        <section key={section.id} className="px-5 py-6">
          <h2 className="text-xl font-bold">{pair(locale, section.headingBn, section.headingEn)}</h2>
          <div className="mt-3 space-y-3">
            {section.items.map((item, i) => (
              <details key={i} className="rounded-xl border border-border bg-card p-4">
                <summary className="cursor-pointer font-medium">{pair(locale, item.questionBn, item.questionEn)}</summary>
                <p className="mt-2 leading-7 text-text-muted">{pair(locale, item.answerBn, item.answerEn)}</p>
              </details>
            ))}
          </div>
        </section>
      );
    case "order_form_note":
      return (
        <section key={section.id} className="px-5 py-4">
          <p className="rounded-xl bg-success-soft p-4 text-center font-medium leading-7 text-success-solid">💵 {pair(locale, section.textBn, section.textEn)}</p>
          {primaryOffer ? (
            <div className="mx-auto mt-4 max-w-xs">
              <OfferBuy offer={primaryOffer} s={s} />
            </div>
          ) : null}
        </section>
      );
    case "quick_order":
      if (!section.product) {
        return (
          <section key={section.id} className="px-5 py-6 text-center text-sm text-text-muted">
            {s.offerUnavailable}
          </section>
        );
      }
      return (
        <section key={section.id} id="landing-order-form" className="scroll-mt-4 px-5 py-8">
          <h2 className="text-xl font-bold">{pair(locale, section.headingBn, section.headingEn)}</h2>
          <p className="mt-1 text-sm leading-6 text-text-muted">
            {s.quickOrderIntro}
          </p>
          <div className="mt-4">
            <QuickOrderForm product={section.product} locale={locale} funnel={ctx.funnelForm} />
          </div>
        </section>
      );
    case "footer_note":
      return (
        <footer key={section.id} className="px-5 py-6 text-center text-sm text-text-muted">
          {pair(locale, section.textBn, section.textEn)}
        </footer>
      );
    case "reviews": {
      // §0.7: unresolved (zero approved reviews, product gone)
      // renders NOTHING — no placeholder praise, no empty shell.
      if (!section.reviews) return null;
      const r = section.reviews;
      return (
        <section key={section.id} className="px-5 py-6">
          <h2 className="text-xl font-bold">{s.reviewsHeading}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-text-muted">
            {r.average !== null ? (
              <>
                <Stars rating={r.average} s={s} />
                <span>{interpolate(s.reviewsAverageLabel, { avg: r.average })}</span>
                <span aria-hidden="true">·</span>
              </>
            ) : null}
            <span>{interpolate(s.reviewsCountLabel, { count: r.count })}</span>
          </p>
          <div className="mt-4 space-y-3">
            {r.items.map((item, i) => (
              <article key={i} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold">{item.authorName}</span>
                  <Stars rating={item.rating} s={s} />
                  {item.verifiedPurchase ? (
                    <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success-solid">{s.verifiedPurchase}</span>
                  ) : null}
                </div>
                {item.title ? <p className="mt-1.5 font-medium leading-6">{item.title}</p> : null}
                <p className="mt-1 whitespace-pre-line leading-7 text-text-muted">{item.body}</p>
                {item.images.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.images.map((url, j) => (
                      <StoreImage key={j} src={url} preset="thumb" alt={item.authorName} className="w-16 rounded-lg" />
                    ))}
                  </div>
                ) : null}
                <p className="mt-2 text-xs text-text-subtle">
                  {new Date(item.createdAt).toLocaleDateString(locale === "en" ? "en-GB" : "bn-BD", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              </article>
            ))}
          </div>
        </section>
      );
    }
    case "gallery": {
      const images = section.images.filter((img) => img.url.trim());
      if (images.length === 0) return null;
      const heading = pair(locale, section.headingBn, section.headingEn);
      return (
        <section key={section.id} className="px-5 py-6">
          {heading ? <h2 className="text-xl font-bold">{heading}</h2> : null}
          {section.layout === "carousel" ? (
            <div className={`mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 ${RAIL_FADE_CLASS}`}>
              {images.map((img, i) => (
                <div key={i} className="w-60 shrink-0 snap-start sm:w-72">
                  <StoreImage image={img} preset="card" locale={locale} className="rounded-xl" />
                </div>
              ))}
            </div>
          ) : (
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {images.map((img, i) => (
                <li key={i}>
                  <StoreImage image={img} preset="square" locale={locale} className="rounded-xl" />
                </li>
              ))}
            </ul>
          )}
        </section>
      );
    }
    case "image_banner": {
      if (!section.imageUrl.trim()) return null;
      const heading = pair(locale, section.headingBn, section.headingEn);
      const banner = (
        <StoreImage
          src={section.imageUrl}
          preset="hero"
          alt={pair(locale, section.altBn, section.altEn)}
          className="rounded-2xl"
        />
      );
      const link = section.linkUrl?.trim() ?? "";
      const linkable = link.startsWith("https://") || link.startsWith("http://") || link.startsWith("/");
      return (
        <section key={section.id} className="px-5 py-6">
          {heading ? <h2 className="mb-3 text-xl font-bold">{heading}</h2> : null}
          {linkable ? (
            <a href={link} className="block" {...(link.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
              {banner}
            </a>
          ) : (
            banner
          )}
        </section>
      );
    }
    case "video": {
      const heading = pair(locale, section.headingBn, section.headingEn);
      return (
        <section key={section.id} className="px-5 py-6">
          {heading ? <h2 className="mb-3 text-xl font-bold">{heading}</h2> : null}
          <VideoFacade videoId={section.videoId} title={heading} playLabel={s.videoPlayAria} />
        </section>
      );
    }
    case "rich_text": {
      const body = pair(locale, section.bodyBn, section.bodyEn);
      if (!body.trim()) return null;
      return (
        <section key={section.id} className="px-5 py-6">
          <RichText body={body} />
        </section>
      );
    }
    case "bundle_offer": {
      // Unavailable bundle (not a bundle product, module off,
      // product gone) renders nothing — §3.4 honesty.
      if (!section.bundle) return null;
      const b = section.bundle;
      const heading = pair(locale, section.headingBn, section.headingEn);
      return (
        <section key={section.id} className="px-5 py-8">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            {heading ? <h2 className="text-xl font-bold">{heading}</h2> : null}
            {b.offer.imageUrl ? (
              <StoreImage
                src={b.offer.imageUrl}
                preset="card"
                alt={pair(locale, b.offer.productTitleBn, b.offer.productTitleEn)}
                className="mb-4 mt-3 rounded-xl"
              />
            ) : null}
            <h3 className="mt-3 text-lg font-bold">{pair(locale, b.offer.productTitleBn, b.offer.productTitleEn)}</h3>
            <p className="text-sm text-text-muted">{b.offer.variantLabel || s.standardVariant}</p>
            <p className="mt-3 flex flex-wrap items-baseline gap-2">
              <span className="text-3xl font-bold text-brand-600">{formatBdt(b.offer.pricePoisha)}</span>
              {b.offer.compareAtPoisha && b.offer.compareAtPoisha > b.offer.pricePoisha ? (
                <span className="text-lg text-text-muted line-through">{formatBdt(b.offer.compareAtPoisha)}</span>
              ) : null}
              {b.savingsPoisha ? (
                <span className="rounded-full bg-success-soft px-2.5 py-1 text-sm font-semibold text-success-solid">
                  {interpolate(s.bundleSavings, { amount: formatBdt(b.savingsPoisha) })}
                </span>
              ) : null}
            </p>
            <div className="mt-4 rounded-xl bg-surface-2 p-4">
              <p className="font-semibold">{s.bundleContentsHeading}</p>
              <p className="mt-0.5 text-sm text-text-muted">{s.bundleFixedNote}</p>
              <ul className="mt-3 space-y-2">
                {b.components.map((c, i) => (
                  <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm leading-6">
                    <span>
                      {pair(locale, c.titleBn || s.bundleComponentFallback, c.titleEn || s.bundleComponentFallback)}
                      {c.variantLabel ? <span className="text-text-muted"> — {c.variantLabel}</span> : null}
                      <span className="font-medium"> × {c.quantity}</span>
                    </span>
                    {c.lineTotalPoisha !== null ? <span className="font-medium">{formatBdt(c.lineTotalPoisha)}</span> : null}
                  </li>
                ))}
              </ul>
              {b.componentsTotalPoisha !== null ? (
                <p className="mt-3 border-t border-border pt-3 text-sm">
                  {s.bundleSeparateTotal}: <span className="font-bold">{formatBdt(b.componentsTotalPoisha)}</span>
                </p>
              ) : null}
            </div>
            <p className="mt-3 text-sm">
              {b.available ? interpolate(s.inStockCount, { count: b.offer.stock }) : s.outOfStock}
            </p>
            {b.available ? (
              <div className="mt-4 flex max-w-xs flex-col gap-2">
                <OfferBuy offer={b.offer} ctaLabel={heroCta} s={s} />
                {section.ctaToOrderForm && hasQuickOrder ? (
                  <a href="#landing-order-form" className="text-center text-sm font-semibold text-brand-600 underline">
                    {s.bundleOrderCta}
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      );
    }
    case "product_grid": {
      // Zero resolved products → nothing renders (§3.4): no
      // empty shell, no placeholder cards.
      if (section.cards.length === 0) return null;
      const heading = pair(locale, section.headingBn, section.headingEn);
      return (
        <section key={section.id} className="px-5 py-6">
          {heading ? <h2 className="text-xl font-bold">{heading}</h2> : null}
          <div className={`mt-3 grid gap-3 ${GRID_COLS_MOBILE[section.columnsMobile]} ${GRID_COLS_DESKTOP[section.columnsDesktop]}`}>
            {section.cards.map((card) => (
              <LandingProductCard
                key={card.variantId}
                card={card}
                locale={locale}
                s={s}
                showPrice={section.showPrice}
                showAddButton={section.showAddButton}
              />
            ))}
          </div>
        </section>
      );
    }
    case "product_carousel": {
      if (section.cards.length === 0) return null;
      const heading = pair(locale, section.headingBn, section.headingEn);
      return (
        <section key={section.id} className="px-5 py-6">
          {heading ? <h2 className="mb-3 text-xl font-bold">{heading}</h2> : null}
          <ProductCarousel
            cards={section.cards}
            locale={locale}
            showPrice={section.showPrice}
            showAddButton={section.showAddButton}
            autoplay={section.autoplay}
          />
        </section>
      );
    }
    case "countdown": {
      // endsAt is null only for a flash-sale target with no
      // sale live — no real end exists, so nothing renders
      // (§0.7). The block owns its own <section> so the
      // expired-hide behaviour leaves no empty shell behind.
      if (!section.endsAt) return null;
      return (
        <CountdownBlock
          key={section.id}
          endsAt={section.endsAt}
          heading={pair(locale, section.headingBn, section.headingEn)}
          expiredText={pair(locale, section.expiredTextBn, section.expiredTextEn)}
          expiredBehavior={section.expiredBehavior}
          locale={locale}
        />
      );
    }
    case "trust_strip": {
      if (section.items.length === 0) return null;
      return (
        <section key={section.id} className="px-5 py-4">
          <ul className="flex flex-wrap items-stretch justify-center gap-2">
            {section.items.map((item, i) => (
              <li
                key={i}
                className="flex items-center gap-2 rounded-xl border border-border/60 bg-surface-2 px-3 py-2 text-sm leading-6 shadow-xs"
              >
                <span aria-hidden="true">{item.icon}</span>
                <span className="font-medium">{pair(locale, item.textBn, item.textEn)}</span>
              </li>
            ))}
          </ul>
        </section>
      );
    }
    case "sticky_bar": {
      // No resolvable primary offer → nothing renders: the
      // bar's price IS the offer's live price, and without one
      // there is nothing honest to show (§3.2). The bar is
      // mobile-first (md:hidden — the desktop column is
      // centred and fully visible), safe-area padded per
      // doc 33, and z-40 like the platform StickyBuyBar:
      // below every drawer/modal (z-50), above page content.
      // It lives inside the /lp page flow only — it never
      // leaves the landing page or fights the theme shell's
      // own fixed elements outside it.
      if (!section.offer) return null;
      const offer = section.offer;
      const label = pair(locale, section.textBn, section.textEn);
      // A quick_order target with no working order form on
      // the page falls back to the offer section — the CTA
      // never points at a missing anchor.
      const href = section.target === "quick_order" && hasQuickOrder ? "#landing-order-form" : "#landing-primary-offer";
      return (
        <Fragment key={section.id}>
          {/* In-flow spacer: the fixed bar must not cover the
              page's last content on phone. */}
          <div aria-hidden="true" className="h-20 md:hidden" />
          <div
            data-product-id={offer.productId}
            data-product-slug={offer.productSlug}
            data-variant-id={offer.variantId}
            className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-2px_10px_rgba(0,0,0,0.08)] backdrop-blur md:hidden"
          >
            <div className="mx-auto flex max-w-3xl items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{label || pair(locale, offer.productTitleBn, offer.productTitleEn)}</p>
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-base font-bold text-brand-600">{formatBdt(offer.pricePoisha)}</span>
                  {offer.compareAtPoisha && offer.compareAtPoisha > offer.pricePoisha ? (
                    <span className="text-sm text-text-muted line-through">{formatBdt(offer.compareAtPoisha)}</span>
                  ) : null}
                </p>
              </div>
              {offer.inStock ? (
                <a
                  href={href}
                  className="flex min-h-11 shrink-0 items-center rounded-lg bg-brand-600 px-5 text-sm font-bold text-white shadow-card transition hover:bg-brand-700 active:scale-[0.98]"
                >
                  {s.defaultCta}
                </a>
              ) : (
                // Out of stock: the stock state replaces the
                // CTA — no dead button (§3.2).
                <span className="shrink-0 rounded-full bg-danger-soft px-3 py-1.5 text-sm font-semibold text-danger">{s.outOfStock}</span>
              )}
            </div>
          </div>
        </Fragment>
      );
    }
  }
}
