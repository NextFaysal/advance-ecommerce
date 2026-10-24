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
}

function variantLabel(variant: BuyBoxVariant): string {
  return Object.values(variant.attributes).join(" / ") || "স্ট্যান্ডার্ড";
}

export function BuyBoxActions({
  productId,
  productTitleBn,
  imageUrl,
  variants,
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
  const outOfStock = !selected || stockCap <= 0;

  // Keep the quantity inside the newly selected variant's stock.
  useEffect(() => {
    setQuantity((q) => Math.min(Math.max(1, q), Math.max(1, stockCap)));
    setNotice(null);
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

      {/* Quantity + add */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-md border border-border">
          <button
            type="button"
            aria-label="পরিমাণ কমান"
            disabled={quantity <= 1}
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            className="flex h-11 w-10 items-center justify-center text-lg disabled:opacity-40"
          >
            −
          </button>
          <span className="w-8 text-center text-sm font-medium tabular-nums" aria-label="পরিমাণ">
            {quantity}
          </span>
          <button
            type="button"
            aria-label="পরিমাণ বাড়ান"
            disabled={outOfStock || quantity >= stockCap}
            onClick={() => setQuantity((q) => Math.min(stockCap, q + 1))}
            className="flex h-11 w-10 items-center justify-center text-lg disabled:opacity-40"
          >
            +
          </button>
        </div>

        <Button
          type="button"
          variant="primary"
          size="lg"
          disabled={outOfStock}
          onClick={addSelected}
          className="flex-1"
        >
          {outOfStock ? "স্টক শেষ" : "কার্টে যোগ করুন"}
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
        এখনই কিনুন
      </Button>

      {notice ? (
        <p role="status" className="text-sm text-brand-700">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
