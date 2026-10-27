"use client";

/**
 * Boighor ProductCard (doc 27 T-C) — ThemeProductCardProps { product }.
 *
 * The catalogue card is this package's signature: a PORTRAIT (3:4)
 * image — the shape of a book cover — over a CENTRED text column:
 * title (2-line clamp), then the brand/author line (the product's
 * real `brandName`, which this catalogue layout treats as the
 * "by" line), a star row, a stock line, the bold price with a grey
 * strikethrough compare-at, and finally Add to Cart + a
 * "View Details" link to the PDP.
 *
 * Cart wiring is NOT re-implemented: the button calls the same
 * addItemToGuestCart() the platform's AddToCartButton uses (same
 * guest-cart contract, same CART_UPDATED_EVENT), then dispatches
 * the drawer-open event only when units were actually added.
 *
 * Badge honesty — every signal comes ONLY from data PublicProduct
 * really carries:
 * - RED CIRCULAR discount badge: the discount percentage computed
 *   from the default variant's compareAtPoisha vs the minimum
 *   variant price (Aurora's exact computation), rendered only when
 *   a real compare-at discount exists.
 * - Star rating: PublicProduct carries `ratingAverage` +
 *   `reviewCount` — the stars render ONLY when ratingAverage is
 *   non-null AND reviewCount > 0. With no reviews the row is
 *   omitted entirely; no rating is ever invented.
 * - Green stock line: shown only when a real active variant has
 *   stock > 0; out-of-stock products show "স্টক শেষ" instead,
 *   exactly like the other packages.
 * - Left flag badge: the product-TYPE label
 *   (PRODUCT_TYPE_BADGE_LABEL) when the product is non-SIMPLE —
 *   the same signal Aurora badges. No bestseller/new labels:
 *   PublicProduct carries no such flag.
 *
 * Price-on-request products show the contact label and no
 * add-to-cart (same gate as Aurora's card).
 */
import { useState } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { BOIGHOR_STRINGS } from "./strings";
import Link from "next/link";
import Image from "next/image";
import { formatBdt } from "@advance-ecommerce/validators";
import { useDigitText } from "@/components/ui/numerals";
import { Icon } from "@/components/ui/icon";
import { Stars } from "@/reviews/components/Stars";
import type { PublicProduct } from "@/catalog/types";
import { minVariantPricePoisha } from "@/catalog/types";
import {
  PRODUCT_TYPE_BADGE_LABEL,
  productTypeOf,
  type PublicProductWithTypeFields,
} from "@/catalog/product-type-contract";
import { addItemToGuestCart } from "@/cart/components/AddToCartButton";
import { useThemeView } from "../theme-view";
import { openCartDrawer } from "../cart-drawer-events";
import { BOIGHOR_COLORS } from "./tokens";
import type { ThemeProductCardProps } from "../slots";

/** The display values the card derives (Aurora's derivations). */
function useCardData(product: PublicProduct) {
  const price = minVariantPricePoisha(product);
  const inStock = product.variants.some((v) => v.isActive && v.stock > 0);
  const defaultVariant =
    product.variants.find((v) => v.isActive && v.stock > 0) ??
    product.variants.find((v) => v.isActive) ??
    null;
  const compareAt = defaultVariant?.compareAtPoisha ?? null;
  const discountPct =
    compareAt !== null && compareAt > price && price > 0
      ? Math.round(((compareAt - price) / compareAt) * 100)
      : 0;
  const imageUrl = product.images[0]?.url ?? defaultVariant?.imageUrl ?? null;
  const cardType = productTypeOf(product as PublicProductWithTypeFields);
  const typeBadgeLabel =
    cardType !== "SIMPLE" ? PRODUCT_TYPE_BADGE_LABEL[cardType] : null;
  // Real review data only — both fields exist on PublicProduct.
  const hasRating = product.ratingAverage !== null && product.reviewCount > 0;
  return {
    price,
    inStock,
    defaultVariant,
    compareAt,
    discountPct,
    imageUrl,
    typeBadgeLabel,
    priceOnRequest: product.priceOnRequest,
    hasRating,
    ratingAverage: product.ratingAverage,
    reviewCount: product.reviewCount,
  };
}

type CardData = ReturnType<typeof useCardData>;

/** The signature red discount DISC — circular, top-right. */
function DiscountDisc({ pct, digits }: { pct: number; digits: (t: string) => string }) {
  const { locale } = useLocale();
  const s = pick(locale, BOIGHOR_STRINGS);
  return (
    <span
      className="flex h-11 w-11 flex-col items-center justify-center rounded-full text-white shadow-pop"
      style={{ backgroundColor: BOIGHOR_COLORS.saleRed }}
    >
      <span className="text-[12px] font-extrabold leading-none">{digits(`-${pct}%`)}</span>
      <span className="mt-0.5 text-[8px] font-bold uppercase leading-none">{s.discountOff}</span>
    </span>
  );
}

function TypeFlag({ label }: { label: string }) {
  return (
    <span className="rounded bg-primary px-1.5 py-0.5 text-[11px] font-bold text-white shadow-sm">
      {label}
    </span>
  );
}

/** Our own book-outline placeholder (drawn in-house) for products
 *  without catalogue imagery — never a broken image. */
function BookPlaceholder() {
  return (
    <svg
      width="46"
      height="46"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3.5h13.5v15H6.8a2.3 2.3 0 0 0-2.3 2.3V6a2.5 2.5 0 0 1 1.5-2.5Z" />
      <path d="M4.5 20.8A2.3 2.3 0 0 1 6.8 18.5h12.7" />
      <path d="M9 8h6.5" />
      <path d="M9 11.5h6.5" />
    </svg>
  );
}

/** The solid-blue add-to-cart button. Calls the platform's
 *  addItemToGuestCart and opens the drawer on a successful add. */
function BoighorAddButton({
  product,
  data,
}: {
  product: PublicProduct;
  data: CardData;
}) {
  const { locale } = useLocale();
  const s = pick(locale, BOIGHOR_STRINGS);
  const [justAdded, setJustAdded] = useState(false);
  const { defaultVariant, inStock } = data;
  if (!defaultVariant || data.priceOnRequest) return null;

  function handleAdd() {
    if (!defaultVariant) return;
    const result = addItemToGuestCart({
      productId: product.id,
      productTitleBn: product.title.bn,
      variant: {
        variantId: defaultVariant.id,
        sku: defaultVariant.sku,
        unitPricePoisha: defaultVariant.pricePoisha,
        compareAtPoisha: defaultVariant.compareAtPoisha,
        stock: defaultVariant.stock,
        imageUrl: defaultVariant.imageUrl ?? product.images[0]?.url ?? null,
      },
      quantity: 1,
    });
    if (result.addedQuantity <= 0) return;
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 2000);
    openCartDrawer();
  }

  return (
    <button
      type="button"
      onClick={handleAdd}
      disabled={!inStock}
      aria-live="polite"
      className={`flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold text-white transition active:scale-[0.98] ${
        inStock
          ? "bg-primary shadow-sm hover:opacity-90"
          : "cursor-not-allowed bg-muted text-text-subtle shadow-none"
      }`}
    >
      <Icon name="cart" size={16} />
      {!inStock ? s.outOfStock : justAdded ? s.addedCheck : s.addToCart}
    </button>
  );
}

/** Standard (vertical, portrait) card — the ProductCard slot. */
export function BoighorProductCard({ product }: ThemeProductCardProps) {
  const { locale } = useLocale();
  const s = pick(locale, BOIGHOR_STRINGS);
  const digits = useDigitText();
  // cardStyle is consumed here as the branch point: "classic" is
  // the only style this package ships (single declared choice).
  const themeView = useThemeView();
  void themeView.options.cardStyle;
  const data = useCardData(product);

  return (
    <article className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card transition duration-200 hover:shadow-lift">
      <Link href={`/product/${product.slug}`} className="block min-w-0">
        {/* Portrait 3:4 image — the catalogue signature */}
        <div className="relative aspect-[3/4] overflow-hidden bg-surface-2">
          {data.imageUrl ? (
            <Image
              src={data.imageUrl}
              alt={product.images[0]?.altBn ?? product.title.bn}
              fill
              sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
              loading="lazy"
              className={`object-cover transition duration-300 group-hover:scale-[1.04] ${data.inStock ? "" : "opacity-60 grayscale"}`}
            />
          ) : (
            <div
              className={`flex h-full w-full items-center justify-center bg-muted text-primary/40 ${data.inStock ? "" : "opacity-60 grayscale"}`}
            >
              <BookPlaceholder />
            </div>
          )}
          {data.typeBadgeLabel ? (
            <span className="absolute left-2 top-2 z-[5]">
              <TypeFlag label={data.typeBadgeLabel} />
            </span>
          ) : null}
          {data.discountPct > 0 && !data.priceOnRequest ? (
            <span className="absolute right-2 top-2 z-[5]">
              <DiscountDisc pct={data.discountPct} digits={digits} />
            </span>
          ) : null}
        </div>

        {/* Centred text column */}
        <div className="px-3 pt-3 text-center">
          <h3 className="line-clamp-2 min-h-[2.6em] break-words text-sm font-semibold leading-snug text-text-main [overflow-wrap:anywhere]">
            {product.title.bn}
          </h3>
          {product.brandName ? (
            <p className="mt-0.5 truncate text-xs font-medium text-text-subtle">
              {product.brandName}
            </p>
          ) : null}

          {/* Stars — ONLY from real review data (see header). */}
          {data.hasRating ? (
            <div className="mt-1.5 flex items-center justify-center gap-1.5">
              <Stars rating={data.ratingAverage ?? 0} size={13} />
              <span className="text-[11px] tabular-nums text-text-subtle">
                {digits(`(${data.reviewCount})`)}
              </span>
            </div>
          ) : null}

          {/* Stock line — real variant stock only. */}
          {data.inStock ? (
            <p className="mt-1.5 flex items-center justify-center gap-1.5 text-xs font-semibold text-success">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
              {s.inStock}
            </p>
          ) : (
            <p className="mt-1.5 text-xs font-semibold text-destructive">{s.outOfStock}</p>
          )}

          <div className="mt-2">
            {data.priceOnRequest ? (
              <p className="text-[15px] font-extrabold text-primary">
                {s.priceOnRequest}
              </p>
            ) : (
              <p className="flex flex-wrap items-baseline justify-center gap-x-2">
                <span className="text-[17px] font-extrabold tabular-nums text-primary">
                  {digits(formatBdt(data.price))}
                </span>
                {data.compareAt !== null && data.compareAt > data.price ? (
                  <span className="text-[13px] tabular-nums text-text-subtle line-through">
                    {digits(formatBdt(data.compareAt))}
                  </span>
                ) : null}
              </p>
            )}
          </div>
        </div>
      </Link>

      <div className="mt-auto px-3 pb-3 pt-2.5">
        <BoighorAddButton product={product} data={data} />
        <Link
          href={`/product/${product.slug}`}
          className="mt-1.5 flex min-h-[32px] items-center justify-center text-[13px] font-semibold text-primary transition hover:underline"
        >
          {s.viewDetails}
        </Link>
      </div>
    </article>
  );
}

export default BoighorProductCard;
