"use client";

/**
 * Bazaar ProductCard (doc 24 wave T2 / doc 25 wave S4a) —
 * ThemeProductCardProps { product }.
 *
 * Grocery-card anatomy: white card, thin border, small radius,
 * SQUARE image, left-aligned title (2-line clamp), bold orange
 * price with a grey strikethrough compare-at, and a full-width
 * white/orange-outline Add To Cart with a cart icon. No star-rating
 * row (the reference listing card has none). Adding to the cart
 * opens this package's cart drawer (cart-drawer-events) — the
 * reference behaviour; /cart remains for deep links.
 *
 * Cart wiring is NOT re-implemented: the button calls the same
 * addItemToGuestCart() the platform's AddToCartButton uses (same
 * guest-cart contract, same CART_UPDATED_EVENT), then dispatches
 * the drawer-open event only when units were actually added.
 *
 * Badge honesty — badges come ONLY from signals PublicProduct
 * really carries:
 * - RIGHT, green saving badge "সাশ্রয় N%": the discount percentage
 *   computed from the default variant's compareAtPoisha vs the
 *   minimum variant price — the exact computation Aurora's card
 *   uses. Rendered only when a real compare-at discount exists.
 * - LEFT flag badge: the product-TYPE label (PRODUCT_TYPE_BADGE_LABEL)
 *   when the product is non-SIMPLE — the same signal Aurora badges.
 *   PublicProduct exposes NO bestseller / new-arrival / flash flag,
 *   so this card never prints "Best Selling" or "New Arrival":
 *   there is no honest source for those labels in the data.
 * - Out of stock: Aurora's "স্টক শেষ" chip + disabled button.
 *
 * Price-on-request products show Aurora's contact label and no
 * add-to-cart (same gate as Aurora's card).
 *
 * `BazaarProductCardHorizontal` is the Top Selling rail variant
 * (doc 24 T2: packshot left ~40%, details right, same price/badge/
 * add-to-cart anatomy). It is composition-internal to this package
 * (S4b's home sections import it directly) and deliberately NOT
 * part of the ProductCard slot contract.
 */
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { formatBdt } from "@advance-ecommerce/validators";
import { useDigitText } from "@/components/ui/numerals";
import { Icon } from "@/components/ui/icon";
import type { PublicProduct } from "@/catalog/types";
import { minVariantPricePoisha } from "@/catalog/types";
import {
  PRODUCT_TYPE_BADGE_LABEL,
  productTypeOf,
  type PublicProductWithTypeFields,
} from "@/catalog/product-type-contract";
import { addItemToGuestCart } from "@/cart/components/AddToCartButton";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { useThemeView } from "../theme-view";
import { BAZAAR_STRINGS } from "./strings";
import { openCartDrawer } from "../cart-drawer-events";
import { BAZAAR_COLORS } from "./tokens";
import type { ThemeProductCardProps } from "../slots";

/** The display values both card variants share (Aurora's derivations). */
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
  return {
    price,
    inStock,
    defaultVariant,
    compareAt,
    discountPct,
    imageUrl,
    typeBadgeLabel,
    priceOnRequest: product.priceOnRequest,
  };
}

type CardData = ReturnType<typeof useCardData>;

function SavingBadge({ pct, digits }: { pct: number; digits: (t: string) => string }) {
  const { locale } = useLocale();
  const s = pick(locale, BAZAAR_STRINGS);
  return (
    <span
      className="rounded-sm px-1.5 py-0.5 text-[11px] font-bold text-white shadow-sm"
      style={{ backgroundColor: BAZAAR_COLORS.savingGreen }}
    >
      {digits(interpolate(s.savingBadge, { pct }))}
    </span>
  );
}

function TypeFlag({ label }: { label: string }) {
  return (
    <span className="rounded-sm bg-primary px-1.5 py-0.5 text-[11px] font-bold text-white shadow-sm">
      {label}
    </span>
  );
}

function BagPlaceholder() {
  return (
    <svg
      width="44"
      height="44"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 8h14l-1.2 12.1a1.5 1.5 0 0 1-1.5 1.4H7.7a1.5 1.5 0 0 1-1.5-1.4L5 8Z" />
      <path d="M8.5 10.5V6.8a3.5 3.5 0 0 1 7 0v3.7" />
    </svg>
  );
}

/**
 * The outline add-to-cart button shared by both variants. Calls the
 * platform's addItemToGuestCart (AddToCartButton's own helper) and
 * opens the drawer on a successful add.
 */
function BazaarAddButton({
  product,
  data,
  className = "",
}: {
  product: PublicProduct;
  data: CardData;
  className?: string;
}) {
  const [justAdded, setJustAdded] = useState(false);
  const { locale } = useLocale();
  const s = pick(locale, BAZAAR_STRINGS);
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
      className={`flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-bold transition active:scale-[0.98] ${
        inStock
          ? "border-primary bg-card text-primary hover:bg-primary hover:text-white"
          : "cursor-not-allowed border-border bg-muted text-text-subtle"
      } ${className}`}
    >
      <Icon name="cart" size={16} />
      {!inStock ? s.outOfStock : justAdded ? s.addedToCart : s.addToCartButton}
    </button>
  );
}

function PriceRow({ data, digits }: { data: CardData; digits: (t: string) => string }) {
  const { locale } = useLocale();
  const s = pick(locale, BAZAAR_STRINGS);
  if (data.priceOnRequest) {
    return (
      <p className="text-[15px] font-extrabold text-primary">{s.priceOnRequest}</p>
    );
  }
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-[17px] font-extrabold tabular-nums text-primary">
        {digits(formatBdt(data.price))}
      </span>
      {data.compareAt !== null && data.compareAt > data.price ? (
        <span className="text-[13px] tabular-nums text-text-subtle line-through">
          {digits(formatBdt(data.compareAt))}
        </span>
      ) : null}
    </p>
  );
}

/** Standard (vertical) card — the ProductCard slot implementation. */
export function BazaarProductCard({ product }: ThemeProductCardProps) {
  const digits = useDigitText();
  const { locale } = useLocale();
  const s = pick(locale, BAZAAR_STRINGS);
  // cardStyle is consumed here as S4a's branch point: "classic" is
  // the only style this wave ships (single declared choice); S4b
  // variants will branch on this value.
  const themeView = useThemeView();
  void themeView.options.cardStyle;
  const data = useCardData(product);

  return (
    <article className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card shadow-card transition duration-200 hover:shadow-lift">
      <Link href={`/product/${product.slug}`} className="block min-w-0">
        <div className="relative aspect-square overflow-hidden bg-surface-2">
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
              <BagPlaceholder />
            </div>
          )}
          {data.typeBadgeLabel ? (
            <span className="absolute left-2 top-2 z-[5]">
              <TypeFlag label={data.typeBadgeLabel} />
            </span>
          ) : null}
          {data.discountPct > 0 && !data.priceOnRequest ? (
            <span className="absolute right-2 top-2 z-[5]">
              <SavingBadge pct={data.discountPct} digits={digits} />
            </span>
          ) : null}
          {!data.inStock ? (
            <span className="absolute bottom-2 left-2 rounded-sm bg-text-main/85 px-2 py-0.5 text-[11px] font-semibold text-white">
              {s.outOfStock}
            </span>
          ) : null}
        </div>

        <div className="px-3 pt-3">
          {product.brandName ? (
            <p className="truncate text-[11px] font-semibold tracking-wide text-text-subtle">
              {product.brandName}
            </p>
          ) : null}
          <h3 className="line-clamp-2 min-h-[2.6em] break-words text-left text-sm font-semibold leading-snug text-text-main [overflow-wrap:anywhere]">
            {product.title.bn}
          </h3>
          <div className="mt-1.5">
            <PriceRow data={data} digits={digits} />
          </div>
        </div>
      </Link>

      <div className="mt-auto px-3 pb-3 pt-2.5">
        <BazaarAddButton product={product} data={data} />
      </div>
    </article>
  );
}

/**
 * Horizontal variant for the Top Selling rail (doc 24 T2): image
 * left (~40%), details right — same badges, price anatomy and
 * add-to-cart behaviour as the standard card.
 */
export function BazaarProductCardHorizontal({
  product,
}: ThemeProductCardProps) {
  const digits = useDigitText();
  const { locale } = useLocale();
  const s = pick(locale, BAZAAR_STRINGS);
  const data = useCardData(product);

  return (
    <article className="group relative flex h-full min-w-0 overflow-hidden rounded-md border border-border bg-card shadow-card transition duration-200 hover:shadow-lift">
      <Link
        href={`/product/${product.slug}`}
        className="relative block w-[40%] shrink-0 self-stretch overflow-hidden bg-surface-2"
        aria-label={product.title.bn}
      >
        {data.imageUrl ? (
          <Image
            src={data.imageUrl}
            alt={product.images[0]?.altBn ?? product.title.bn}
            fill
            sizes="(max-width: 768px) 40vw, 20vw"
            loading="lazy"
            className={`object-cover transition duration-300 group-hover:scale-[1.04] ${data.inStock ? "" : "opacity-60 grayscale"}`}
          />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center bg-muted text-primary/40 ${data.inStock ? "" : "opacity-60 grayscale"}`}
          >
            <BagPlaceholder />
          </div>
        )}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          {data.typeBadgeLabel ? (
            <TypeFlag label={data.typeBadgeLabel} />
          ) : (
            <span />
          )}
          {data.discountPct > 0 && !data.priceOnRequest ? (
            <SavingBadge pct={data.discountPct} digits={digits} />
          ) : null}
        </div>
        <Link href={`/product/${product.slug}`} className="mt-1.5 block min-w-0">
          {product.brandName ? (
            <p className="truncate text-[11px] font-semibold tracking-wide text-text-subtle">
              {product.brandName}
            </p>
          ) : null}
          <h3 className="line-clamp-2 break-words text-left text-sm font-semibold leading-snug text-text-main [overflow-wrap:anywhere]">
            {product.title.bn}
          </h3>
          <div className="mt-1.5">
            <PriceRow data={data} digits={digits} />
          </div>
          {!data.inStock ? (
            <p className="mt-1 text-xs font-medium text-destructive">{s.outOfStock}</p>
          ) : null}
        </Link>
        <div className="mt-auto pt-2.5">
          <BazaarAddButton product={product} data={data} />
        </div>
      </div>
    </article>
  );
}

export default BazaarProductCard;
