// Landing view renderer — Agent 53. Server-friendly presentational
// component shared by the public /lp/[slug] page and the admin preview
// pane, so preview == public output. The buy CTA reuses the existing
// guest-cart helper via AddToCartButton (the same component ProductCard
// uses): clicking adds the offer variant to the guest cart; a second
// link goes to the product page. No new tracking code — the wrapper only
// carries data-product-* attributes for the existing tracking shell.
import { formatBdt } from "@advance-ecommerce/validators";
import { AddToCartButton } from "@/cart/components/AddToCartButton";
import { CountdownNote } from "./CountdownNote";
import type { LandingViewModel, ResolvedOffer } from "../render";

function OfferBuy({ offer, ctaLabelBn }: { offer: ResolvedOffer; ctaLabelBn?: string }) {
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
        labelBn={ctaLabelBn ?? "এখনই অর্ডার করুন"}
      />
      <a href={`/product/${offer.productSlug}`} className="text-center text-sm text-brand-600 underline">
        পণ্যের বিস্তারিত দেখুন
      </a>
    </div>
  );
}

export function LandingView({ view }: { view: LandingViewModel }) {
  const heroCta = view.sections.find((s) => s.kind === "hero")?.ctaLabelBn;
  return (
    <div className="mx-auto max-w-3xl">
      {view.sections.map((section) => {
        switch (section.kind) {
          case "hero":
            return (
              <section key={section.id} className="brand-gradient rounded-b-2xl px-5 py-10 text-center text-white">
                <h1 className="text-3xl font-bold leading-snug">{section.titleBn}</h1>
                {section.subtitleBn ? <p className="mx-auto mt-3 max-w-xl leading-7">{section.subtitleBn}</p> : null}
                {view.primaryOffer ? (
                  <div className="mx-auto mt-6 max-w-xs rounded-xl bg-white/95 p-3 text-left">
                    <OfferBuy offer={view.primaryOffer} ctaLabelBn={section.ctaLabelBn} />
                  </div>
                ) : null}
              </section>
            );
          case "product_offer":
            if (!section.offer) {
              return (
                <section key={section.id} className="px-5 py-6 text-center text-sm text-text-muted">
                  এই অফারের পণ্যটি এখন পাওয়া যাচ্ছে না।
                </section>
              );
            }
            return (
              <section key={section.id} className="px-5 py-8">
                <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                  <h2 className="text-xl font-bold">{section.offer.productTitleBn}</h2>
                  <p className="text-sm text-text-muted">{section.offer.variantLabel}</p>
                  <p className="mt-3 flex flex-wrap items-baseline gap-2">
                    <span className="text-3xl font-bold text-brand-600">{formatBdt(section.offer.pricePoisha)}</span>
                    {section.offer.compareAtPoisha && section.offer.compareAtPoisha > section.offer.pricePoisha ? (
                      <span className="text-lg text-text-muted line-through">{formatBdt(section.offer.compareAtPoisha)}</span>
                    ) : null}
                  </p>
                  {section.discountNoteBn ? <p className="mt-1 text-sm text-emerald-600">{section.discountNoteBn}</p> : null}
                  {section.showCountdown && section.countdownEndsAt ? <CountdownNote endsAt={section.countdownEndsAt} /> : null}
                  <p className="mt-2 text-sm">{section.offer.inStock ? `স্টক আছে (${section.offer.stock}টি)` : "স্টক শেষ"}</p>
                  <div className="mt-4 max-w-xs">
                    <OfferBuy offer={section.offer} ctaLabelBn={heroCta} />
                  </div>
                </div>
              </section>
            );
          case "benefits":
            return (
              <section key={section.id} className="px-5 py-6">
                <h2 className="text-xl font-bold">{section.headingBn}</h2>
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {section.items.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 rounded-xl bg-surface-2 p-3">
                      <span aria-hidden="true">{item.icon}</span>
                      <span className="leading-7">{item.textBn}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          case "how_to_order":
            return (
              <section key={section.id} className="px-5 py-6">
                <h2 className="text-xl font-bold">{section.headingBn}</h2>
                <ol className="mt-3 space-y-2">
                  {section.steps.map((step, i) => (
                    <li key={i} className="flex items-start gap-3 leading-7">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 font-bold text-white">{i + 1}</span>
                      <span>{step.textBn}</span>
                    </li>
                  ))}
                </ol>
              </section>
            );
          case "faq":
            return (
              <section key={section.id} className="px-5 py-6">
                <h2 className="text-xl font-bold">{section.headingBn}</h2>
                <div className="mt-3 space-y-3">
                  {section.items.map((item, i) => (
                    <details key={i} className="rounded-xl border border-border bg-card p-4">
                      <summary className="cursor-pointer font-medium">{item.questionBn}</summary>
                      <p className="mt-2 leading-7 text-text-muted">{item.answerBn}</p>
                    </details>
                  ))}
                </div>
              </section>
            );
          case "order_form_note":
            return (
              <section key={section.id} className="px-5 py-4">
                <p className="rounded-xl bg-emerald-50 p-4 text-center font-medium leading-7 text-emerald-800">💵 {section.textBn}</p>
                {view.primaryOffer ? (
                  <div className="mx-auto mt-4 max-w-xs">
                    <OfferBuy offer={view.primaryOffer} />
                  </div>
                ) : null}
              </section>
            );
          case "footer_note":
            return (
              <footer key={section.id} className="px-5 py-6 text-center text-sm text-text-muted">
                {section.textBn}
              </footer>
            );
        }
      })}
    </div>
  );
}
