"use client";

/**
 * Haat ProductCard (doc 27 theme T-A) — ThemeProductCardProps
 * { product }.
 *
 * Dense marketplace card anatomy: white card, thin border, tight
 * radius, SQUARE image, 2-line clamp title, bold orange price with
 * a grey strikethrough compare-at, and a full-width SOLID-orange
 * Add To Cart. Adding to the cart opens this package's cart
 * drawer (cart-drawer-events) — /cart remains for deep links.
 *
 * Cart wiring is NOT re-implemented: the button calls the same
 * addItemToGuestCart() the platform's AddToCartButton uses (same
 * guest-cart contract, same CART_UPDATED_EVENT), then dispatches
 * the drawer-open event only when units were actually added.
 *
 * Badge honesty — badges come ONLY from signals PublicProduct
 * really carries:
 * - LEFT, orange discount chip "-N%": the discount percentage
 *   computed from the default variant's compareAtPoisha vs the
 *   minimum variant price — the exact computation the platform's
 *   other cards use. Rendered ONLY when a real compare-at
 *   discount exists; no chip is ever invented.
 * - RIGHT flag badge: the product-TYPE label
 *   (PRODUCT_TYPE_BADGE_LABEL) when the product is non-SIMPLE —
 *   the same signal the other packages badge. PublicProduct
 *   exposes NO bestseller / new-arrival / flash flag, so this
 *   card never prints such labels.
 * - Out of stock: a "স্টক শেষ" chip + disabled button (parity).
 *
 * Price-on-request products show the contact label and no
 * add-to-cart (same gate as the platform's other cards).
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
import { pick } from "@/i18n/locale";
import { openCartDrawer } from "../cart-drawer-events";
import { HAAT_STRINGS } from "./strings";
import type { ThemeProductCardProps } from "../slots";

/** The display values the card derives (the platform's derivations). */
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

/** Our own placeholder mark (bag outline), drawn in-house. */
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
 * The solid add-to-cart button. Calls the platform's
 * addItemToGuestCart (AddToCartButton's own helper) and opens the
 * drawer on a successful add.
 */
function HaatAddButton({
  product,
  data,
}: {
  product: PublicProduct;
  data: CardData;
}) {
  const { locale } = useLocale();
  const s = pick(locale, HAAT_STRINGS);
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
      className={`flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded px-3 py-2 text-sm font-bold text-white transition active:scale-[0.98] ${
        inStock
          ? "bg-primary shadow-sm hover:opacity-90"
          : "cursor-not-allowed bg-muted text-text-subtle shadow-none"
      }`}
    >
      <Icon name="cart" size={16} />
      {!inStock ? s.outOfStock : justAdded ? s.addedShort : s.addToCartLabel}
    </button>
  );
}

/** The ProductCard slot implementation. */
export function HaatProductCard({ product }: ThemeProductCardProps) {
  const { locale } = useLocale();
  const s = pick(locale, HAAT_STRINGS);
  const digits = useDigitText();
  const data = useCardData(product);

  return (
    <article className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded border border-border bg-card shadow-card transition duration-200 hover:shadow-lift">
      <Link href={`/product/${product.slug}`} className="block min-w-0">
        <div className="relative aspect-square overflow-hidden bg-surface-2">
          {data.imageUrl ? (
            <Image
              src={data.imageUrl}
              alt={product.images[0]?.altBn ?? product.title.bn}
              fill
              sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 20vw"
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
          {/* Discount chip — ONLY from a real compare-at (see header). */}
          {data.discountPct > 0 && !data.priceOnRequest ? (
            <span className="absolute left-0 top-2 z-[5] rounded-r bg-primary px-1.5 py-0.5 text-[11px] font-extrabold text-white shadow-sm">
              {digits(`-${data.discountPct}%`)}
            </span>
          ) : null}
          {data.typeBadgeLabel ? (
            <span className="absolute right-2 top-2 z-[5] rounded-sm bg-text-main/85 px-1.5 py-0.5 text-[11px] font-bold text-white shadow-sm">
              {data.typeBadgeLabel}
            </span>
          ) : null}
          {!data.inStock ? (
            <span className="absolute bottom-2 left-2 rounded-sm bg-text-main/85 px-2 py-0.5 text-[11px] font-semibold text-white">
              {s.outOfStock}
            </span>
          ) : null}
        </div>

        <div className="px-2.5 pt-2.5">
          {product.brandName ? (
            <p className="truncate text-[11px] font-semibold tracking-wide text-text-subtle">
              {product.brandName}
            </p>
          ) : null}
          <h3 className="line-clamp-2 min-h-[2.6em] break-words text-left text-sm font-medium leading-snug text-text-main [overflow-wrap:anywhere]">
            {product.title.bn}
          </h3>
          <div className="mt-1.5">
            {data.priceOnRequest ? (
              <p className="text-[15px] font-extrabold text-primary">
                {s.priceOnRequest}
              </p>
            ) : (
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
            )}
          </div>
        </div>
      </Link>

      <div className="mt-auto px-2.5 pb-2.5 pt-2">
        <HaatAddButton product={product} data={data} />
      </div>
    </article>
  );
}

export default HaatProductCard;
