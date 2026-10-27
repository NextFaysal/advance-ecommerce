"use client";

/**
 * Haat PDP buy section (doc 27 theme T-A) — the interactive
 * heart of the Haat PDP: variant chips, the selected variant's
 * price row, the quantity stepper and the 2×2 action grid
 * (pdp-actions.tsx).
 *
 * PURCHASING PARITY (hard rule): the state machine mirrors
 * BuyBoxActions (src/cart/components/BuyBoxActions.tsx) line for
 * line in behaviour —
 * - variants come from its own BuyBoxVariant shape via props;
 *   the default selection is the first ACTIVE in-stock variant
 *   (else the first active one);
 * - quantity is milli-exact via @/lib/quantity (addQty/subQty),
 *   steps by the weighted step when the variant is a weighted
 *   one (weightedSteps), and is re-clamped to [step, stock]
 *   whenever the selection or stock cap changes;
 * - the ONLY cart write is addItemToGuestCart with the same
 *   AddToCartInput shape (allowFractional only for weighted
 *   variants), and its addedQuantity/capped semantics drive the
 *   same Bengali notices BuyBoxActions shows;
 * - BUY NOW = add, then router.push("/checkout") — and only when
 *   the add actually put something in the cart;
 * - the low-stock line uses the same threshold + copy.
 *
 * Presentation differences (the reason this component exists):
 * variant chips are tight rectangles with an orange selected
 * state; the price row re-computes from the SELECTED variant
 * (big orange price, grey strike, green "Save ৳X (N%)" pill —
 * real compare-at data only); ADD TO CART also opens the
 * package's cart drawer on success; WhatsApp/Call buttons appear
 * only when a configured number is passed in (none exists in
 * the platform today, so they are omitted — see pdp-actions.tsx).
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatBdt } from "@advance-ecommerce/validators";
import { addQty, subQty, qtyToString, qtyToMilli } from "@/lib/quantity";
import { useDigitText } from "@/components/ui/numerals";
import { Icon } from "@/components/ui/icon";
import type { BuyBoxActionsProps } from "@/cart/components/BuyBoxActions";
import { addItemToGuestCart } from "@/cart/components/AddToCartButton";
import { openCartDrawer } from "../cart-drawer-events";
import { HAAT_COLORS } from "./tokens";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { HAAT_STRINGS } from "./strings";
import HaatPdpActions from "./pdp-actions";

export interface HaatPdpBuySectionProps extends BuyBoxActionsProps {
  /** Configured store WhatsApp number — none is exposed publicly
   *  today, so callers pass nothing and the button is omitted. */
  whatsappNumber?: string | null;
  /** Configured store hotline number — same as above. */
  callNumber?: string | null;
}

export default function HaatPdpBuySection({
  productId,
  productTitleBn,
  imageUrl,
  variants,
  ctaLabel,
  buyNowLabel,
  forceUnavailable = false,
  unavailableLabel,
  lowStockThreshold,
  weightedSteps,
  whatsappNumber,
  callNumber,
}: HaatPdpBuySectionProps) {
  const router = useRouter();
  const { locale } = useLocale();
  const s = pick(locale, HAAT_STRINGS);
  const digits = useDigitText();
  const activeVariants = useMemo(() => variants.filter((v) => v.isActive), [variants]);
  const defaultVariant = useMemo(
    () => activeVariants.find((v) => v.stock > 0) ?? activeVariants[0] ?? null,
    [activeVariants],
  );
  const [selectedId, setSelectedId] = useState<string | null>(defaultVariant?.id ?? null);
  const selected = activeVariants.find((v) => v.id === selectedId) ?? defaultVariant;
  const stockCap = selected ? Math.max(0, selected.stock) : 0;
  const outOfStock = forceUnavailable || !selected || stockCap <= 0;
  // Weighted variants step by their step quantity (600g piece =
  // 1.2 of a 500g pack, …); integer-stock variants step by 1.
  const stepInfo = selected ? weightedSteps?.[selected.id] : undefined;
  const qtyStep = stepInfo?.stepQuantity ?? 1;
  const qtyMin = qtyStep;
  const [quantity, setQuantity] = useState(qtyMin);
  const [notice, setNotice] = useState<string | null>(null);

  // Sync the default selection if the variant list changes.
  useEffect(() => {
    if (defaultVariant && (!selectedId || !activeVariants.some((v) => v.id === selectedId))) {
      setSelectedId(defaultVariant.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultVariant?.id]);

  // Keep the quantity inside [step, stock cap] for the selection.
  useEffect(() => {
    setQuantity((q) => {
      const cap = Math.max(qtyMin, stockCap);
      if (q < qtyMin) return qtyMin;
      if (q > cap) return cap;
      return q;
    });
    setNotice(null);
  }, [selectedId, stockCap, qtyMin]);

  if (!selected) return null;

  const lowStock =
    lowStockThreshold !== null &&
    lowStockThreshold !== undefined &&
    !forceUnavailable &&
    selected.stock > 0 &&
    selected.stock <= lowStockThreshold;

  const attributeKeys = Array.from(
    new Set(activeVariants.flatMap((v) => Object.keys(v.attributes))),
  );

  // Selected-variant price row: real compare-at data only.
  const hasDiscount = selected.compareAtPoisha !== null && selected.compareAtPoisha > selected.pricePoisha;
  const savePoisha = hasDiscount ? selected.compareAtPoisha! - selected.pricePoisha : 0;
  const savePct = hasDiscount ? Math.round((savePoisha / selected.compareAtPoisha!) * 100) : 0;

  /** Same write path + result handling as BuyBoxActions. */
  function addSelected(): boolean {
    if (!selected || outOfStock) return false;
    const result = addItemToGuestCart({
      productId,
      productTitleBn,
      variant: {
        variantId: selected.id,
        sku: selected.sku,
        unitPricePoisha: selected.pricePoisha,
        compareAtPoisha: selected.compareAtPoisha,
        stock: selected.stock,
        imageUrl: selected.imageUrl ?? imageUrl ?? null,
      },
      quantity,
      allowFractional: stepInfo !== undefined,
    });
    if (result.addedQuantity <= 0) {
      setNotice(s.noticeOutOfStock);
      return false;
    }
    setNotice(
      result.capped ? s.noticeAddedCapped : s.noticeAdded,
    );
    return true;
  }

  return (
    <div>
      {/* Variant chips — tight rectangles, orange selected state */}
      {attributeKeys.length > 0 && activeVariants.length > 1 ? (
        <div className="space-y-2.5">
          {attributeKeys.map((key) => {
            const values = Array.from(
              new Set(activeVariants.map((v) => v.attributes[key]).filter(Boolean)),
            );
            return (
              <div key={key} className="flex flex-wrap items-center gap-2">
                <span className="min-w-[64px] text-[13px] font-bold text-text-main">{key}:</span>
                {values.map((value) => {
                  const candidate = activeVariants.find((v) => v.attributes[key] === value);
                  if (!candidate) return null;
                  const isActive = candidate.id === selected.id;
                  const soldOut = candidate.stock <= 0;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSelectedId(candidate.id)}
                      aria-pressed={isActive}
                      className={`min-h-[40px] rounded border px-3.5 text-sm font-semibold transition duration-200 active:scale-[0.97] ${
                        isActive
                          ? "border-primary bg-primary/10 text-primary ring-1 ring-primary"
                          : "border-input bg-card text-text-main hover:border-primary/60"
                      } ${soldOut ? "opacity-55" : ""}`}
                    >
                      {value}
                      {soldOut ? s.soldOutSuffix : ""}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : activeVariants.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {activeVariants.map((v) => {
            const isActive = v.id === selected.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelectedId(v.id)}
                aria-pressed={isActive}
                className={`min-h-[40px] rounded border px-3.5 text-sm font-semibold transition duration-200 active:scale-[0.97] ${
                  isActive
                    ? "border-primary bg-primary/10 text-primary ring-1 ring-primary"
                    : "border-input bg-card text-text-main hover:border-primary/60"
                } ${v.stock <= 0 ? "opacity-55" : ""}`}
              >
                {v.sku}
                {v.stock <= 0 ? s.soldOutSuffix : ""}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Price row — from the SELECTED variant */}
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-display text-[28px] font-extrabold leading-none text-primary sm:text-[32px]">
          {digits(formatBdt(selected.pricePoisha))}
        </span>
        {hasDiscount ? (
          <>
            <span className="text-base font-medium text-text-subtle line-through">
              {digits(formatBdt(selected.compareAtPoisha!))}
            </span>
            <span
              className="rounded-full px-2.5 py-1 text-xs font-bold text-white"
              style={{ backgroundColor: HAAT_COLORS.discountGreen }}
            >
              {digits(interpolate(s.savePill, { amount: formatBdt(savePoisha), pct: savePct }))}
            </span>
          </>
        ) : null}
      </div>
      {lowStock ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-warning">
          <Icon name="alert" size={14} />
          {digits(interpolate(s.onlyLeftOrderFast, { stock: selected.stock }))}
        </p>
      ) : null}

      <hr className="my-5 border-border" />

      {/* Quantity */}
      <div>
        <span id="haat-qty-label" className="text-sm font-bold text-text-main">
          {s.quantityLabel}
        </span>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <div className="flex h-11 items-stretch overflow-hidden rounded border border-input bg-card">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(qtyMin, subQty(q, qtyStep)))}
              disabled={outOfStock || quantity <= qtyMin}
              aria-label={s.decreaseQuantity}
              className="flex w-11 items-center justify-center text-text-main transition hover:bg-muted disabled:opacity-40"
            >
              <Icon name="minus" size={16} />
            </button>
            <span
              aria-live="polite"
              className="flex min-w-[52px] items-center justify-center border-x border-input px-2 text-[15px] font-bold tabular-nums text-text-main"
            >
              {digits(qtyToString(quantity))}
            </span>
            <button
              type="button"
              onClick={() => setQuantity((q) => addQty(q, qtyStep))}
              disabled={outOfStock || quantity >= Math.max(qtyMin, stockCap)}
              aria-label={s.increaseQuantity}
              className="flex w-11 items-center justify-center text-text-main transition hover:bg-muted disabled:opacity-40"
            >
              <Icon name="plus" size={16} />
            </button>
          </div>
          {stepInfo ? (
            <p className="text-[13px] text-text-muted">
              {digits(
                interpolate(s.gramsApprox, { grams: Math.round((qtyToMilli(quantity) * stepInfo.packGrams) / 1000), step: stepInfo.packGrams }),
              )}
            </p>
          ) : null}
        </div>
      </div>

      {/* 2×2 action grid — ADD TO CART also opens the drawer on
          success (package behaviour); BUY NOW navigates, exactly
          like BuyBoxActions. */}
      <div className="mt-5">
        <HaatPdpActions
          onAdd={() => {
            if (addSelected()) openCartDrawer();
          }}
          onBuyNow={() => {
            if (addSelected()) router.push("/checkout");
          }}
          outOfStock={outOfStock}
          ctaLabel={ctaLabel}
          buyNowLabel={buyNowLabel}
          unavailableLabel={unavailableLabel}
          whatsappNumber={whatsappNumber}
          callNumber={callNumber}
          productTitleBn={productTitleBn}
        />
      </div>

      {notice ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-success" role="status">
          <Icon name="check" size={15} />
          {notice}
        </p>
      ) : null}
    </div>
  );
}
