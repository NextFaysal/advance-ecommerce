/**
 * Landing collection product card (doc 34 L2) — the cell of the
 * product_grid and product_carousel blocks. Same data shape and buy
 * path as the product_offer card: live catalog values carried by
 * ResolvedOffer, purchase through the platform's AddToCartButton
 * (guest-cart helper — the one order path, §0.3). An out-of-stock
 * product still renders its cell with the out-of-stock label (the
 * button disables itself at stock 0); only a product with no active
 * variant at all drops out, upstream in the view model.
 */
import { formatBdt } from "@advance-ecommerce/validators";
import { AddToCartButton } from "@/cart/components/AddToCartButton";
import { StoreImage } from "@/storefront-ux/components/StoreImage";
import { interpolate, type Locale } from "@/i18n/locale";
import type { LandingStrings } from "../../strings";
import type { ResolvedOffer } from "../../render";

/** The doc-30 pair pick: the locale's half, Bangla when it is empty. */
function pair(locale: Locale, bn: string, en: string): string {
  return locale === "en" ? en || bn : bn;
}

export function LandingProductCard({
  card,
  locale,
  s,
  showPrice,
  showAddButton,
}: {
  card: ResolvedOffer;
  locale: Locale;
  s: LandingStrings;
  showPrice: boolean;
  showAddButton: boolean;
}) {
  const title = pair(locale, card.productTitleBn, card.productTitleEn);
  return (
    <article
      data-product-id={card.productId}
      data-product-slug={card.productSlug}
      data-variant-id={card.variantId}
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
    >
      <a href={`/product/${card.productSlug}`} className="block">
        {card.imageUrl ? (
          <StoreImage src={card.imageUrl} preset="card" alt={title} />
        ) : null}
      </a>
      <div className="flex flex-1 flex-col p-3">
        <h3 className="font-semibold leading-6">
          <a href={`/product/${card.productSlug}`}>{title}</a>
        </h3>
        {card.variantLabel ? (
          <p className="mt-0.5 text-sm text-text-muted">{card.variantLabel}</p>
        ) : null}
        {showPrice ? (
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
            <span className="text-xl font-bold text-brand-600">{formatBdt(card.pricePoisha)}</span>
            {card.compareAtPoisha && card.compareAtPoisha > card.pricePoisha ? (
              <span className="text-sm text-text-muted line-through">{formatBdt(card.compareAtPoisha)}</span>
            ) : null}
          </p>
        ) : null}
        <p className="mt-1 text-sm">
          {card.inStock ? interpolate(s.inStockCount, { count: card.stock }) : s.outOfStock}
        </p>
        {showAddButton ? (
          <div className="mt-auto pt-3">
            <AddToCartButton
              productId={card.productId}
              productTitleBn={card.productTitleBn}
              variant={{
                variantId: card.variantId,
                sku: card.sku,
                unitPricePoisha: card.pricePoisha,
                compareAtPoisha: card.compareAtPoisha,
                stock: card.stock,
                imageUrl: card.imageUrl,
              }}
              labelBn={s.defaultCta}
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}
