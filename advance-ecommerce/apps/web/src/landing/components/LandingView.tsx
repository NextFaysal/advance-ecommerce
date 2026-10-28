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
import { formatBdt } from "@advance-ecommerce/validators";
import { AddToCartButton } from "@/cart/components/AddToCartButton";
import { StoreImage } from "@/storefront-ux/components/StoreImage";
import { interpolate, pick, type Locale } from "@/i18n/locale";
import { LANDING_STRINGS, type LandingStrings } from "../strings";
import { CountdownNote } from "./CountdownNote";
import { QuickOrderForm } from "./QuickOrderForm";
import type { LandingViewModel, ResolvedOffer } from "../render";

/** The doc-30 pair pick: the locale's half, Bangla when it is empty. */
function pair(locale: Locale, bn: string, en: string): string {
  return locale === "en" ? en || bn : bn;
}

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

export function LandingView({ view, locale = "bn" }: { view: LandingViewModel; locale?: Locale }) {
  const s = pick(locale, LANDING_STRINGS);
  const hero = view.sections.find((sec) => sec.kind === "hero");
  const heroCta = hero ? pair(locale, hero.ctaLabelBn, hero.ctaLabelEn) : undefined;
  return (
    <div className="mx-auto max-w-3xl">
      {view.sections.map((section) => {
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
                {view.primaryOffer ? (
                  <div className="mx-auto mt-6 max-w-xs rounded-xl bg-white/95 p-3 text-left">
                    <OfferBuy offer={view.primaryOffer} ctaLabel={pair(locale, section.ctaLabelBn, section.ctaLabelEn)} s={s} />
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
              <section key={section.id} className="px-5 py-8">
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
                    <p className="mt-1 text-sm text-emerald-600">{pair(locale, section.discountNoteBn, section.discountNoteEn)}</p>
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
                <p className="rounded-xl bg-emerald-50 p-4 text-center font-medium leading-7 text-emerald-800">💵 {pair(locale, section.textBn, section.textEn)}</p>
                {view.primaryOffer ? (
                  <div className="mx-auto mt-4 max-w-xs">
                    <OfferBuy offer={view.primaryOffer} s={s} />
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
              <section key={section.id} className="px-5 py-8">
                <h2 className="text-xl font-bold">{pair(locale, section.headingBn, section.headingEn)}</h2>
                <p className="mt-1 text-sm leading-6 text-text-muted">
                  {s.quickOrderIntro}
                </p>
                <div className="mt-4">
                  <QuickOrderForm product={section.product} locale={locale} />
                </div>
              </section>
            );
          case "footer_note":
            return (
              <footer key={section.id} className="px-5 py-6 text-center text-sm text-text-muted">
                {pair(locale, section.textBn, section.textEn)}
              </footer>
            );
        }
      })}
    </div>
  );
}
