"use client";

// Buy-box actions — Agent 35 (Add-to-Cart Wiring).
// Mounted inside the product page's #buy-box. The product page is
// server-rendered and its variant chips are static (no selection state), so
// this component owns a small client variant picker that mirrors the
// displayed variants 1:1 (same order, same labels/prices) — the add always
// targets the variant selected HERE, never a guessed default. The static
// chips further up the page stay as the informational variant list.
// Adds go through addItemToGuestCart() (AddToCartButton.tsx) — the same
// guest-cart contract as everywhere else. StickyBuyBar is untouched: it only
// observes #buy-box visibility and keeps its own placeholder button.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatBdt } from "@advance-ecommerce/validators";
import { Button } from "@/components/ui/button";
import { useDigitText } from "@/components/ui/numerals";
import { addQty, qtyToMilli, qtyToString, subQty } from "@/lib/quantity";
import { addItemToGuestCart } from "./AddToCartButton";

export interface BuyBoxVariant {
  id: string;
  sku: string;
  /** e.g. { color: "লাল" } / { size: "M" } — display strings. */
  attributes: Record<string, string>;
  /** Integer poisha. */
  pricePoisha: number;
  /** Integer poisha, nullable. */
  compareAtPoisha: number | null;
  stock: number;
  isActive: boolean;
  imageUrl: string | null;
}

export interface BuyBoxActionsProps {
  productId: string;
  productTitleBn: string;
  /** Product-level fallback image when a variant has none. */
  imageUrl?: string | null;
  variants: BuyBoxVariant[];
  /** Optional CTA overrides (wave 15 product types): a PREORDER
   *  product labels its buy box "প্রি-অর্ডার করুন". Unset = the
   *  standard labels, byte-identical to before. */
  ctaLabel?: string;
  buyNowLabel?: string;
  /** Force the sold-out state regardless of variant stock — a BUNDLE
   *  whose components cannot currently fulfil it (PDP reads the
   *  service's bundleAvailability) disables buying exactly like a
   *  sold-out variant. */
  forceUnavailable?: boolean;
  /** Label shown on the disabled CTA when forceUnavailable applies. */
  unavailableLabel?: string;
  /** Doc 23 wave 60 (P11, honest social proof): when set, the buy
   *  box shows a truthful "মাত্র Nটি বাকি" line for the SELECTED
   *  variant while its real stock is 1..threshold (the PDP passes
   *  LOW_STOCK_THRESHOLD from src/marketing/social-proof.ts only
   *  while the module.social_proof flag is on). The number is
   *  always the variant's actual stock — stock 0 stays the plain
   *  sold-out state and is never dressed up as urgency.
   *  Null/unset = never shown; default behaviour is unchanged. */
  lowStockThreshold?: number | null;
  /** Wave 59: fractional stepping for grocery weighted variants —
   *  variantId -> { stepQuantity (pack units, from the pack's weight
   *  step), packGrams }. A variant present here steps fractionally
   *  from one step and may be added fractionally; every other variant
   *  keeps whole-unit stepping exactly as before. The PDP passes this
   *  only for variants in the grocery pack's weightedVariants config,
   *  and checkout re-gates fractions server-side regardless. */
  weightedSteps?: Record<string, { stepQuantity: number; packGrams: number }>;
}

function variantLabel(variant: BuyBoxVariant): string {
  return Object.values(variant.attributes).join(" / ") || "স্ট্যান্ডার্ড";
}

export function BuyBoxActions({
  productId,
  productTitleBn,
  imageUrl,
  variants,
  ctaLabel,
  buyNowLabel,
  forceUnavailable,
  unavailableLabel,
  lowStockThreshold,
  weightedSteps,
}: BuyBoxActionsProps) {
  const router = useRouter();
  const digits = useDigitText();
  const activeVariants = useMemo(
    () => variants.filter((v) => v.isActive),
    [variants],
  );

  // Default selection: first in-stock active variant, else the first active.
  const defaultVariant =
    activeVariants.find((v) => v.stock > 0) ?? activeVariants[0] ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(
    defaultVariant?.id ?? null,
  );
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);

  const selected =
    activeVariants.find((v) => v.id === selectedId) ?? defaultVariant;
  const stockCap = selected ? Math.max(0, selected.stock) : 0;
  const outOfStock = Boolean(forceUnavailable) || !selected || stockCap <= 0;
  // Wave 59: the selected variant's quantity step — fractional for
  // weighted variants, 1 for everything else.
  const stepInfo = selected ? weightedSteps?.[selected.id] : undefined;
  const qtyStep = stepInfo?.stepQuantity ?? 1;
  const qtyMin = qtyStep;

  // Keep the quantity inside the newly selected variant's stock.
  useEffect(() => {
    setQuantity((q) => Math.min(Math.max(qtyMin, q), Math.max(qtyMin, stockCap)));
    setNotice(null);
    // qtyMin derives from the selection; stockCap covers its changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, stockCap]);

  if (!selected) return null;

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
      setNotice("স্টকে আর নেই — কার্টে যোগ করা যায়নি।");
      return false;
    }
    setNotice(
      result.capped
        ? "কার্টে যোগ হয়েছে — স্টকে যা ছিল সব নেওয়া হয়েছে।"
        : "কার্টে যোগ হয়েছে ✓",
    );
    return true;
  }

  function buyNow() {
    if (addSelected()) router.push("/checkout");
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      {/* Variant picker — mirrors the server-rendered variant list. */}
      <div>
        <p className="text-sm font-semibold">
          ভেরিয়েন্ট বেছে নিন:{" "}
          <span className="font-normal text-text-muted">
            {variantLabel(selected)}
          </span>
        </p>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="ভেরিয়েন্ট">
          {activeVariants.map((v) => {
            const isSelected = v.id === selected.id;
            return (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setSelectedId(v.id)}
                className={`min-h-[44px] rounded-full border px-3 py-1 text-sm ${
                  isSelected
                    ? "border-brand-500 bg-brand-50 font-semibold text-brand-700"
                    : "border-border text-text-main hover:bg-surface-2"
                }`}
              >
                {variantLabel(v)} — {digits(formatBdt(v.pricePoisha))}
                {v.stock > 0 ? ` (স্টক: ${v.stock})` : " (স্টক শেষ)"}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-lg font-bold text-brand-700">
        {digits(formatBdt(selected.pricePoisha))}
        {selected.compareAtPoisha !== null &&
        selected.compareAtPoisha > selected.pricePoisha ? (
          <span className="ml-2 text-sm font-normal text-text-subtle line-through">
            {digits(formatBdt(selected.compareAtPoisha))}
          </span>
        ) : null}
      </p>

      {/* Real low-stock line (wave 60): the SELECTED variant's
          actual stock, only in the 1..threshold band, and never
          while a bundle force-unavailable state is contradicting
          it. No threshold prop (flag off) = no line at all. */}
      {lowStockThreshold != null &&
      !forceUnavailable &&
      selected.stock > 0 &&
      selected.stock <= lowStockThreshold ? (
        <p role="status" className="-mt-1 text-sm font-semibold text-amber-600 dark:text-amber-400">
          {digits(`মাত্র ${selected.stock}টি বাকি`)}
        </p>
      ) : null}

      {/* Quantity + add */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-md border border-border">
          <button
            type="button"
            aria-label="পরিমাণ কমান"
            disabled={quantity <= qtyMin}
            onClick={() => setQuantity((q) => Math.max(qtyMin, subQty(q, qtyStep)))}
            className="flex h-11 w-10 items-center justify-center text-lg disabled:opacity-40"
          >
            −
          </button>
          <span className="w-8 text-center text-sm font-medium tabular-nums" aria-label="পরিমাণ">
            {qtyToString(quantity)}
          </span>
          <button
            type="button"
            aria-label="পরিমাণ বাড়ান"
            disabled={outOfStock || quantity >= stockCap}
            onClick={() => setQuantity((q) => Math.min(stockCap, addQty(q, qtyStep)))}
            className="flex h-11 w-10 items-center justify-center text-lg disabled:opacity-40"
          >
            +
          </button>
        </div>
        {stepInfo ? (
          <span className="text-xs text-text-muted">
            ≈ {digits(`${Math.round((qtyToMilli(quantity) * stepInfo.packGrams) / 1000)}`)} গ্রাম
          </span>
        ) : null}

        <Button
          type="button"
          variant="primary"
          size="lg"
          disabled={outOfStock}
          onClick={addSelected}
          className="flex-1"
        >
          {outOfStock ? (unavailableLabel ?? "স্টক শেষ") : (ctaLabel ?? "কার্টে যোগ করুন")}
        </Button>
      </div>

      <Button
        type="button"
        variant="gradient"
        size="lg"
        disabled={outOfStock}
        onClick={buyNow}
        className="w-full"
      >
        {buyNowLabel ?? "এখনই কিনুন"}
      </Button>

      {notice ? (
        <p role="status" className="text-sm text-brand-700">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
