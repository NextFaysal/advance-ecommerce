"use client";

/**
 * Shobji CartDrawer slot — doc 27 theme T-B.
 *
 * The slide-in cart this package's header button, floating tab
 * and product cards open (cart-drawer-events), rendered on the
 * platform's shared Drawer primitive (overlay, Escape, scroll
 * lock and safe-area footer come free):
 *
 *   header "SHOPPING CART" · line rows (thumb, name, compact
 *   stepper, "unit × qty = line total", remove ×) · "You May Also
 *   Like" mini-cards · footer subtotal + full-width purple
 *   CHECKOUT.
 *
 * CART PARITY (hard rule): the drawer reads and writes the SAME
 * guest cart CartPageClient uses — loadGuestCart / saveGuestCart
 * (src/cart/persistence.ts) and addItemToGuestCart
 * (src/cart/components/AddToCartButton.ts) for suggestions. Money
 * math uses the same helpers (lineTotalPoisha, cartSubtotalPoisha,
 * cartItemCount) and stepper arithmetic uses @/lib/quantity, so a
 * line edited here is byte-identical to one edited on /cart.
 * Differences from CartPageClient are deliberate and documented:
 * - lines render from the cart's own snapshots (no catalog prop
 *   exists in the drawer contract), so the stepper cap is the
 *   snapshot's availableStock — the value addItemToGuestCart
 *   stores at write time — instead of a live catalog stock;
 * - fractional (weighted) lines step by the platform's default
 *   weighted step (0.5) when the quantity itself is fractional,
 *   matching the quantity module's DEFAULT_WEIGHTED_STEP;
 * - after its own saves the drawer dispatches CART_UPDATED_EVENT
 *   (CartPageClient's persist does not) so the header/floating
 *   cart counts refresh immediately — same event, same listeners.
 *
 * "You May Also Like" fetches the public products API client-side
 * (GET /api/v1/public/products), excludes products already in the
 * cart, and adds through addItemToGuestCart with the same default
 * variant derivation the product card uses. A failed fetch simply
 * hides the rail — the drawer never blocks on it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatBdt } from "@advance-ecommerce/validators";
import { Drawer } from "@/components/ui/drawer";
import { Icon } from "@/components/ui/icon";
import { useDigitText } from "@/components/ui/numerals";
import {
  addQty,
  subQty,
  qtyToString,
  isFractionalQty,
  lineTotalPoisha,
  DEFAULT_WEIGHTED_STEP,
} from "@/lib/quantity";
import {
  addItemToGuestCart,
  CART_UPDATED_EVENT,
} from "@/cart/components/AddToCartButton";
import { loadGuestCart, saveGuestCart } from "@/cart/persistence";
import { cartItemCount, cartSubtotalPoisha, type Cart } from "@/cart/types";
import { minVariantPricePoisha, type PublicProduct } from "@/catalog/types";
import type { ThemeCartDrawerProps } from "../slots";

/** Our own empty-cart mark (cart outline) — drawn in-house. */
function EmptyCartMark() {
  return (
    <svg
      width="72"
      height="72"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
      <path d="M2.5 3.5h2l2.5 11.2a1.6 1.6 0 0 0 1.6 1.3h7.9a1.6 1.6 0 0 0 1.6-1.3L19.5 7H6" />
    </svg>
  );
}

export default function ShobjiCartDrawer({ open, onClose }: ThemeCartDrawerProps) {
  const digits = useDigitText();
  const [cart, setCart] = useState<Cart | null>(null);
  const [suggestions, setSuggestions] = useState<PublicProduct[]>([]);
  const fetchedRef = useRef(false);

  const refresh = useCallback(() => {
    setCart(loadGuestCart());
  }, []);

  /* Load on open; stay fresh while open (other surfaces — cards,
     the PDP — write to the same cart). */
  useEffect(() => {
    if (!open) return;
    refresh();
    const onFocus = () => refresh();
    window.addEventListener(CART_UPDATED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener(CART_UPDATED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", onFocus);
    };
  }, [open, refresh]);

  /* Suggestions: one fetch per session, from the public API. */
  useEffect(() => {
    if (!open || fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;
    fetch("/api/v1/public/products?pageSize=12")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json) return;
        const data: unknown = (json as { data?: unknown }).data;
        if (Array.isArray(data)) setSuggestions(data as PublicProduct[]);
      })
      .catch(() => {
        /* suggestions are optional — a failed fetch hides the rail */
      });
    return () => {
      cancelled = true;
    };
  }, [open ]);

  /** Persist an items array the CartPageClient way, then broadcast
   *  so header counts/floating tab refresh immediately. */
  const persist = useCallback(
    (next: Cart) => {
      const saved: Cart = { ...next, updatedAt: new Date().toISOString() };
      saveGuestCart(saved);
      setCart(saved);
      window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT));
    },
    [],
  );

  const items = useMemo(() => cart?.items ?? [], [cart]);
  const inCartIds = useMemo(() => new Set(items.map((i) => i.productId)), [items]);
  const subtotal = cart ? cartSubtotalPoisha(cart) : 0;
  const count = cart ? cartItemCount(cart) : 0;
  const likeProducts = useMemo(
    () => suggestions.filter((p) => !inCartIds.has(p.id)).slice(0, 6),
    [suggestions, inCartIds],
  );

  /** ProductId → slug map for name links (from the same fetch). */
  const slugByProductId = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of suggestions) map.set(p.id, p.slug);
    return map;
  }, [suggestions]);

  const stepFor = (quantity: number) =>
    isFractionalQty(quantity) ? DEFAULT_WEIGHTED_STEP : 1;

  const changeQuantity = (variantId: string, delta: 1 | -1) => {
    if (!cart) return;
    const nextItems = cart.items
      .map((item) => {
        if (item.variantId !== variantId) return item;
        const step = stepFor(item.quantity);
        const q =
          delta > 0
            ? addQty(item.quantity, step)
            : subQty(item.quantity, step);
        // Remove the line when it steps to/below zero (≥1 step).
        if (q <= 0) return null;
        // Never exceed the snapshot's known availability.
        const capped = Math.min(q, Math.max(step, item.availableStock));
        return { ...item, quantity: capped };
      })
      .filter((i): i is NonNullable<typeof i> => i !== null);
    persist({ ...cart, items: nextItems });
  };

  const removeLine = (variantId: string) => {
    if (!cart) return;
    persist({ ...cart, items: cart.items.filter((i) => i.variantId !== variantId) });
  };

  const addSuggestion = (p: PublicProduct) => {
    const active = p.variants.filter((v) => v.isActive);
    const variant = active.find((v) => v.stock > 0) ?? active[0] ?? null;
    if (!variant) return;
    const result = addItemToGuestCart({
      productId: p.id,
      productTitleBn: p.title.bn,
      variant: {
        variantId: variant.id,
        sku: variant.sku,
        unitPricePoisha: variant.pricePoisha,
        compareAtPoisha: variant.compareAtPoisha,
        stock: variant.stock,
        imageUrl: variant.imageUrl ?? p.images[0]?.url ?? null,
      },
      quantity: 1,
    });
    if (result.addedQuantity > 0) refresh();
  };

  return (
    <Drawer open={open} onClose={onClose} title="SHOPPING CART"
      footer={
        items.length > 0 ? (
          <div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">
                মোট ({digits(`${count}টি পণ্য`)})
              </span>
              <span className="font-display text-lg font-extrabold text-text-main">
                {digits(formatBdt(subtotal))}
              </span>
            </div>
            <p className="mt-1 text-xs text-text-subtle">
              ডেলিভারি চার্জ চেকআউটে হিসাব হবে।
            </p>
            <Link
              href="/checkout"
              onClick={onClose}
              className="mt-3 flex h-12 items-center justify-center rounded-full bg-primary text-sm font-bold uppercase tracking-wide text-white shadow-sm transition hover:opacity-90"
            >
              Checkout
            </Link>
            <Link
              href="/cart"
              onClick={onClose}
              className="mt-2 flex h-10 items-center justify-center text-sm font-semibold text-primary hover:underline"
            >
              কার্ট পেজে যান
            </Link>
          </div>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        /* ---------- Empty state ---------- */
        <div className="flex h-full flex-col items-center justify-center px-4 py-10 text-center">
          <span className="text-primary/50">
            <EmptyCartMark />
          </span>
          <p className="mt-4 font-display text-lg font-extrabold text-text-main">
            আপনার কার্ট খালি
          </p>
          <p className="mt-1 max-w-[260px] text-sm leading-6 text-text-muted">
            এখনো কোনো পণ্য যোগ করা হয়নি — পছন্দের পণ্য যোগ করে কেনাকাটা শুরু করুন।
          </p>
          <Link
            href="/shop"
            onClick={onClose}
            className="mt-5 inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-bold text-white shadow-sm transition hover:opacity-90"
          >
            কেনাকাটা শুরু করুন
          </Link>
        </div>
      ) : (
        <>
          {/* ---------- Line rows ---------- */}
          <ul className="divide-y divide-border">
            {items.map((item) => {
              const step = stepFor(item.quantity);
              const slug = slugByProductId.get(item.productId);
              return (
                <li key={item.variantId} className="flex gap-3 py-3.5">
                  <span className="h-[64px] w-[64px] shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.imageUrl}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center font-display text-lg font-extrabold text-primary/40">
                        {item.name.charAt(0)}
                      </span>
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      {slug ? (
                        <Link
                          href={`/product/${slug}`}
                          onClick={onClose}
                          className="line-clamp-2 min-w-0 break-words text-sm font-semibold leading-snug text-text-main transition hover:text-primary [overflow-wrap:anywhere]"
                        >
                          {item.name}
                        </Link>
                      ) : (
                        <span className="line-clamp-2 min-w-0 break-words text-sm font-semibold leading-snug text-text-main [overflow-wrap:anywhere]">
                          {item.name}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeLine(item.variantId)}
                        aria-label={`${item.name} সরান`}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-subtle transition hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Icon name="x" size={15} />
                      </button>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-text-subtle">
                      SKU: {item.sku}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      {/* Compact stepper — same quantity calls as /cart */}
                      <div className="flex h-9 items-stretch overflow-hidden rounded-full border border-input bg-card">
                        <button
                          type="button"
                          onClick={() => changeQuantity(item.variantId, -1)}
                          aria-label="পরিমাণ কমান"
                          className="flex w-9 items-center justify-center text-text-main transition hover:bg-muted"
                        >
                          <Icon name="minus" size={14} />
                        </button>
                        <span className="flex min-w-[40px] items-center justify-center border-x border-input px-1.5 text-sm font-bold tabular-nums text-text-main">
                          {digits(qtyToString(item.quantity))}
                        </span>
                        <button
                          type="button"
                          onClick={() => changeQuantity(item.variantId, 1)}
                          disabled={item.quantity >= Math.max(step, item.availableStock)}
                          aria-label="পরিমাণ বাড়ান"
                          className="flex w-9 items-center justify-center text-text-main transition hover:bg-muted disabled:opacity-40"
                        >
                          <Icon name="plus" size={14} />
                        </button>
                      </div>

                      <p className="text-[13px] text-text-muted">
                        {digits(
                          `${formatBdt(item.unitPricePoisha)} × ${qtyToString(item.quantity)} = `,
                        )}
                        <span className="font-bold text-text-main">
                          {digits(formatBdt(lineTotalPoisha(item.unitPricePoisha, item.quantity)))}
                        </span>
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* ---------- You May Also Like ---------- */}
          {likeProducts.length > 0 ? (
            <section className="mt-5" aria-label="আপনার ভালো লাগতে পারে">
              <h3 className="font-display text-[15px] font-extrabold text-text-main">
                You May Also Like
              </h3>
              <div className="scrollbar-none -mx-1 mt-3 flex gap-2.5 overflow-x-auto px-1 pb-1">
                {likeProducts.map((p) => {
                  const price = minVariantPricePoisha(p);
                  const addable = p.variants.some((v) => v.isActive && v.stock > 0);
                  return (
                    <div
                      key={p.id}
                      className="w-[128px] shrink-0 rounded-xl border border-border bg-card p-2 shadow-card"
                    >
                      <Link
                        href={`/product/${p.slug}`}
                        onClick={onClose}
                        className="block aspect-square overflow-hidden rounded-lg bg-muted"
                      >
                        {p.images[0]?.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.images[0].url}
                            alt={p.title.bn}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center font-display text-xl font-extrabold text-primary/40">
                            {p.title.bn.charAt(0)}
                          </span>
                        )}
                      </Link>
                      <Link
                        href={`/product/${p.slug}`}
                        onClick={onClose}
                        className="mt-2 line-clamp-1 block break-words text-xs font-semibold text-text-main transition hover:text-primary [overflow-wrap:anywhere]"
                      >
                        {p.title.bn}
                      </Link>
                      <p className="mt-0.5 text-[13px] font-bold text-primary">
                        {digits(formatBdt(price))}
                      </p>
                      <button
                        type="button"
                        onClick={() => addSuggestion(p)}
                        disabled={!addable}
                        className="mt-1.5 flex h-8 w-full items-center justify-center gap-1 rounded-full bg-primary text-xs font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Icon name="plus" size={13} />
                        {addable ? "Add" : "স্টক শেষ"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </>
      )}
    </Drawer>
  );
}
