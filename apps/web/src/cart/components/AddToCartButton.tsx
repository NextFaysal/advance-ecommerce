"use client";

// Add-to-cart — Agent 35 (Add-to-Cart Wiring).
// Writes REAL guest carts through the existing contracts only:
// - State: src/cart/persistence (loadGuestCart / saveGuestCart, localStorage
//   key "advance-ecommerce-guest-cart") with the src/cart/types CartItem
//   shape — the exact shape src/cart/components/resolve.ts resolves on /cart
//   (variantId first, SKU fallback, then the item's own snapshot fields).
// - Snapshot fields stored per item: variantId, productId, name, sku,
//   unitPricePoisha, quantity, availableStock, imageUrl. The CartItem shape
//   has NO compare-at field, so compareAtPoisha is accepted in the input for
//   contract completeness but not stored — /cart derives the compare-at
//   discount from the catalog variant (see resolve.ts), never from here.
// - Money is integer poisha; the stored unit price is the variant snapshot
//   price as-is (no recomputation). Checkout re-validates server-side.
// - Header cart count: SiteHeader refreshes on window `storage` + `focus`
//   only (same-tab localStorage writes fire neither), so after saving we
//   dispatch CART_UPDATED_EVENT for any listener; the header does not listen
//   for it yet — its count refreshes on the next focus/navigation. One-line
//   follow-up in SiteHeader: add a CART_UPDATED_EVENT listener next to the
//   storage/focus ones.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { milliToQty, qtyToMilli } from "@/lib/quantity";
import { loadGuestCart, saveGuestCart } from "../persistence";
import { CART_STRINGS } from "../strings";
import type { Cart, CartItem } from "../types";

export const CART_UPDATED_EVENT = "advance-ecommerce:cart-updated";

export interface AddToCartVariantSnapshot {
  variantId: string;
  sku: string;
  /** Unit price in integer poisha — stored as the cart snapshot price. */
  unitPricePoisha: number;
  /** Accepted for completeness; NOT stored (CartItem has no compare-at). */
  compareAtPoisha?: number | null;
  /** Stock available for the variant; adds are capped at this. */
  stock: number;
  imageUrl?: string | null;
}

export interface AddToCartInput {
  productId: string;
  /** Product title snapshot (Bangla display name) stored as item.name. */
  productTitleBn: string;
  variant: AddToCartVariantSnapshot;
  quantity: number;
  /** Wave 59: a grocery weighted variant may be added in fractional
   *  pack quantities (kept milli-exact instead of floored). Only the
   *  PDP buy box sets this, for configured weighted variants; the
   *  server re-gates fractions at checkout regardless. */
  allowFractional?: boolean;
}

export interface AddToCartResult {
  cart: Cart;
  /** Units actually added after the stock cap (0 when out of stock). */
  addedQuantity: number;
  /** True when the requested quantity was capped by stock. */
  capped: boolean;
}

/** Load the guest cart or start a new empty one. */
export function loadOrCreateGuestCart(): Cart {
  return (
    loadGuestCart() ?? {
      ownerKey: "guest",
      ownerType: "guest",
      items: [],
      updatedAt: new Date().toISOString(),
    }
  );
}

/**
 * Add (or increment) one variant in the guest cart, capped at the variant's
 * stock, then persist. Pure with respect to the cart contract: returns the
 * new cart plus how many units were really added.
 */
export function addItemToGuestCart(input: AddToCartInput): AddToCartResult {
  const cart = loadOrCreateGuestCart();
  const { variant } = input;
  const stockCap = Math.max(0, variant.stock);
  // All quantity arithmetic in milli-units (wave 59): whole-unit adds
  // floor sloppy inputs exactly as before; fractional adds (weighted
  // variants only) keep their milli-exact quantity.
  const requestedMilli = input.allowFractional
    ? Math.max(0, qtyToMilli(input.quantity))
    : Math.max(0, Math.floor(input.quantity)) * 1000;

  const existing = cart.items.find((i) => i.variantId === variant.variantId);
  const alreadyMilli = existing ? qtyToMilli(existing.quantity) : 0;
  const addedMilli = Math.max(
    0,
    Math.min(requestedMilli, stockCap * 1000 - alreadyMilli),
  );
  const addedQuantity = milliToQty(addedMilli);

  let items: CartItem[];
  if (existing) {
    items = cart.items.map((i) =>
      i.variantId === variant.variantId
        ? {
            ...i,
            quantity: milliToQty(alreadyMilli + addedMilli),
            // Refresh the snapshot to the latest add-time values.
            sku: variant.sku,
            unitPricePoisha: variant.unitPricePoisha,
            availableStock: stockCap,
            imageUrl: variant.imageUrl ?? i.imageUrl,
          }
        : i,
    );
  } else if (addedQuantity > 0) {
    items = [
      ...cart.items,
      {
        variantId: variant.variantId,
        productId: input.productId,
        name: input.productTitleBn,
        sku: variant.sku,
        unitPricePoisha: variant.unitPricePoisha,
        quantity: addedQuantity,
        availableStock: stockCap,
        imageUrl: variant.imageUrl ?? undefined,
      },
    ];
  } else {
    items = cart.items;
  }

  const next: Cart = { ...cart, items, updatedAt: new Date().toISOString() };
  saveGuestCart(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT));
  }
  return {
    cart: next,
    addedQuantity,
    capped: addedMilli < requestedMilli,
  };
}

export interface AddToCartButtonProps {
  productId: string;
  productTitleBn: string;
  variant: AddToCartVariantSnapshot;
  /** Units per click (default 1). */
  quantity?: number;
  className?: string;
  /** Button label before adding. Caller-supplied content (e.g. a
   *  landing page's merchant CTA) shown verbatim; when unset the
   *  localized COMMON addToCart label is used. */
  labelBn?: string;
}

export function AddToCartButton({
  productId,
  productTitleBn,
  variant,
  quantity = 1,
  className = "",
  labelBn,
}: AddToCartButtonProps) {
  const { locale, t } = useLocale();
  const s = pick(locale, CART_STRINGS);
  const [added, setAdded] = useState(false);
  const [capped, setCapped] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const outOfStock = variant.stock <= 0;

  function handleAdd() {
    const result = addItemToGuestCart({
      productId,
      productTitleBn,
      variant,
      quantity,
    });
    if (result.addedQuantity <= 0) return;
    setCapped(result.capped);
    setAdded(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(false), 2000);
  }

  return (
    <span className={`inline-flex flex-col ${className}`}>
      <Button
        type="button"
        variant={added ? "secondary" : "primary"}
        onClick={handleAdd}
        disabled={outOfStock}
        aria-live="polite"
        className="w-full"
      >
        {outOfStock ? t.outOfStock : added ? s.addedToCart : (labelBn ?? t.addToCart)}
      </Button>
      {added && capped ? (
        <span role="status" className="mt-1 text-xs text-text-muted">
          {s.allStockAddedNotice}
        </span>
      ) : null}
    </span>
  );
}
