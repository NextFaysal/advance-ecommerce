"use client";

// Cart page client — Agent 33 (Storefront Cart Page).
// State: the existing guest cart (src/cart/persistence, localStorage).
// When no guest cart exists yet, the honest EMPTY cart state renders —
// no fabricated demo items. Product details resolve against the real
// catalog list passed as a prop by the server shell (ACTIVE products
// from the Prisma repository via src/catalog/server-read); items whose
// product left the catalog fall back to their add-time snapshot.
// Totals preview uses the same pipeline order as
// checkout: subtotal -> item discounts -> coupon -> shipping -> COD fee
// -> tax -> grand total, computed with checkout/pricing computePricing().
// Coupons are NOT evaluated on this page (doc 21 G3-3): there is no
// public coupon read API, so the entered code is only stored on the
// cart and the real DB coupon set is evaluated server-side at order
// create — the preview therefore carries no coupon discount. Checkout
// still re-validates every price/stock server-side.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { useBengaliNumerals } from "@/components/ui/numerals";
import { computePricing } from "@/checkout/pricing";
import type { PublicProduct } from "@/catalog/types";
import { getWishlistIds, toggleWishlistId } from "@/catalog/wishlist";
import {
  clearGuestCart,
  loadGuestCart,
  saveGuestCart,
} from "../persistence";
import { cartSubtotalPoisha, type Cart } from "../types";
import {
  CART_SHIPPING_ZONES,
  cartItemDiscountPoisha,
  resolveCartLines,
  type CartShippingZone,
} from "./resolve";

export interface WeightedVariantAnnotation {
  packGrams: number;
  pricePerKgPoisha: number;
  derivedPricePoisha: number;
  inSync: boolean;
}

export default function CartPageClient({
  catalogProducts,
  weightedVariants,
}: {
  catalogProducts: PublicProduct[];
  /** ADV-22 (grocery pack): per-kg pack annotations by variantId, fed
   *  by the server shell; absent/empty unless the pack is on. */
  weightedVariants?: Record<string, WeightedVariantAnnotation>;
}) {
  const bengaliDigits = useBengaliNumerals();
  const [cart, setCart] = useState<Cart | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [zoneId, setZoneId] = useState<CartShippingZone["id"]>("inside_dhaka");
  const [couponInput, setCouponInput] = useState("");
  // The coupon code stored on the cart (cart.couponCode) — carried to
  // checkout, where the server evaluates it against the real DB
  // coupons. It applies NO discount in this page's preview.
  const [savedCouponCode, setSavedCouponCode] = useState<string | null>(null);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Cart-share (ADV-19): the minted signed link + its UI state. The
  // link is created by POST /api/v1/public/cart-share (server signs;
  // nothing is stored server-side).
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);

  useEffect(() => {
    const guest = loadGuestCart();
    if (guest && guest.items.length > 0) {
      setCart(guest);
      if (guest.couponCode) {
        setCouponInput(guest.couponCode);
        setSavedCouponCode(guest.couponCode);
      }
    } else {
      setCart(null);
    }
    setLoaded(true);
  }, []);

  const lines = useMemo(
    () => (cart ? resolveCartLines(cart, catalogProducts) : []),
    [cart, catalogProducts],
  );
  const zone =
    CART_SHIPPING_ZONES.find((z) => z.id === zoneId) ?? CART_SHIPPING_ZONES[0]!;

  const subtotalPoisha = cart ? cartSubtotalPoisha(cart) : 0;
  const itemDiscountPoisha = cartItemDiscountPoisha(lines);
  const afterItemDiscountPoisha = Math.max(0, subtotalPoisha - itemDiscountPoisha);

  // No coupon discount in the preview: the stored code (if any) is
  // evaluated server-side at order create against the real DB coupons
  // (doc 21 G3-3) — this page cannot resolve codes honestly.
  const pricing = computePricing({
    itemsSubtotalPoisha: afterItemDiscountPoisha,
    couponDiscountPoisha: 0,
    shippingPoisha: zone.chargePoisha,
    // COD fee is 0 in the current pricing config (same as /checkout demo);
    // the row stays in the breakdown so the pipeline order is visible.
    codFeePoisha: 0,
    taxBps: 0,
  });

  function persist(next: Cart) {
    const withTime = { ...next, updatedAt: new Date().toISOString() };
    setCart(withTime);
    if (withTime.ownerType === "guest") saveGuestCart(withTime);
  }

  function setQuantity(variantId: string, quantity: number) {
    if (!cart) return;
    const line = lines.find((l) => l.item.variantId === variantId);
    const cap = line ? Math.max(1, line.stockCap) : quantity;
    const clamped = Math.min(Math.max(1, quantity), cap);
    persist({
      ...cart,
      items: cart.items.map((i) =>
        i.variantId === variantId ? { ...i, quantity: clamped } : i,
      ),
    });
  }

  function removeItem(variantId: string) {
    if (!cart) return;
    persist({ ...cart, items: cart.items.filter((i) => i.variantId !== variantId) });
    setNotice("পণ্যটি কার্ট থেকে সরানো হয়েছে।");
  }

  function clearCart() {
    clearGuestCart();
    setCart(null);
    setSavedCouponCode(null);
    setCouponMessage(null);
    setNotice(null);
  }

  function saveForLater(variantId: string) {
    const line = lines.find((l) => l.item.variantId === variantId);
    if (!line || !cart) return;
    const already = getWishlistIds().includes(line.item.productId);
    if (!already) toggleWishlistId(line.item.productId);
    persist({ ...cart, items: cart.items.filter((i) => i.variantId !== variantId) });
    setNotice(
      already
        ? "পণ্যটি আগেই উইশলিস্টে ছিল — কার্ট থেকে সরানো হয়েছে।"
        : "পণ্যটি উইশলিস্টে রাখা হয়েছে।",
    );
  }

  // Stores the code on the cart only — no client-side resolution
  // exists (no public coupon API). The server evaluates the code
  // against the real DB coupons when the order is created; a wrong or
  // ineligible code is reported on the checkout confirmation.
  function applyCouponCode() {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    setSavedCouponCode(code);
    setCouponMessage(
      `কুপন ${code} সংরক্ষণ করা হয়েছে — চেকআউটে সার্ভার যাচাই করে ছাড় প্রয়োগ করবে।`,
    );
    if (cart) persist({ ...cart, couponCode: code });
  }

  function removeCoupon() {
    setSavedCouponCode(null);
    setCouponMessage(null);
    setCouponInput("");
    if (cart) {
      const next = { ...cart };
      delete next.couponCode;
      persist(next);
    }
  }

  if (!loaded) {
    return (
      <main className="mx-auto min-w-0 max-w-7xl px-4 py-6">
        <h1 className="text-xl font-bold">আপনার কার্ট</h1>
        <p className="mt-4 text-sm text-text-muted">কার্ট লোড হচ্ছে…</p>
      </main>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <main className="mx-auto min-w-0 max-w-7xl px-4 py-6">
        <h1 className="text-xl font-bold">আপনার কার্ট</h1>
        <p className="mt-1 text-xs text-text-subtle">
          পণ্যের তথ্য আসল ক্যাটালগ (ডাটাবেস) থেকে আসে; কার্ট এই ব্রাউজারেই সংরক্ষিত থাকে।
        </p>
        <div className="mt-8 rounded-xl border bg-card px-4 py-10 text-center">
          <p aria-hidden="true" className="text-4xl">🛒</p>
          <p className="mt-3 font-medium">আপনার কার্ট খালি</p>
          <p className="mt-1 text-sm text-text-muted">পছন্দের পণ্য কার্টে যোগ করলেই এখানে দেখা যাবে।</p>
          <Link
            href="/shop"
            className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white"
          >
            কেনাকাটা শুরু করুন
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-w-0 max-w-7xl px-4 pb-32 pt-6 lg:pb-6">
      <h1 className="text-xl font-bold">আপনার কার্ট</h1>
      <p className="mt-1 text-xs text-text-subtle">
        পণ্যের তথ্য আসল ক্যাটালগ (ডাটাবেস) থেকে আসে; কার্ট এই ব্রাউজারেই সংরক্ষিত থাকে।
      </p>

      {notice ? (
        <p role="status" className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">
          {notice}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Line items */}
        <div className="min-w-0">
          <ul className="flex flex-col gap-3 lg:gap-0 lg:divide-y lg:divide-border lg:rounded-xl lg:border lg:border-border lg:bg-card lg:shadow-card">
            {lines.map((line) => (
              <li
                key={line.item.variantId}
                className="flex gap-3 rounded-xl border border-border bg-card p-3 shadow-card sm:gap-4 sm:p-4 lg:rounded-none lg:border-0 lg:shadow-none"
              >
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-surface-2 px-1 text-center text-xs text-text-muted sm:h-24 sm:w-24">
                  {line.titleBn}
                </div>
                <div className="min-w-0 flex-1">
                  {line.productSlug ? (
                    <Link href={`/product/${line.productSlug}`} className="font-medium [overflow-wrap:anywhere] hover:text-brand-700">
                      {line.titleBn}
                    </Link>
                  ) : (
                    <p className="font-medium [overflow-wrap:anywhere]">{line.titleBn}</p>
                  )}
                  {line.variantLabel ? (
                    <p className="text-sm text-text-muted">{line.variantLabel}</p>
                  ) : null}
                  <p className="text-xs text-text-subtle">SKU: {line.item.sku}</p>
                  {weightedVariants?.[line.item.variantId] ? (
                    <p className="mt-1 text-xs leading-5 text-text-muted">
                      ⚖️ ওজন প্যাক: {weightedVariants[line.item.variantId]!.packGrams} গ্রাম · প্রতি
                      কেজি{" "}
                      <Money
                        bengaliDigits={bengaliDigits}
                        poisha={weightedVariants[line.item.variantId]!.pricePerKgPoisha}
                      />
                      {weightedVariants[line.item.variantId]!.inSync ? (
                        <>
                          {" "}· প্যাকের দাম{" "}
                          <Money
                            bengaliDigits={bengaliDigits}
                            poisha={weightedVariants[line.item.variantId]!.derivedPricePoisha}
                          />
                        </>
                      ) : (
                        <span className="text-text-subtle"> · (হার অনুযায়ী দাম হালনাগাদ বাকি)</span>
                      )}
                    </p>
                  ) : null}
                  <p className="mt-1 text-sm">
                    <Money bengaliDigits={bengaliDigits} poisha={line.item.unitPricePoisha} />
                    {line.discountPoishaPerUnit > 0 && line.variant?.compareAtPoisha ? (
                      <span className="ml-2 text-text-subtle line-through">
                        <Money bengaliDigits={bengaliDigits} poisha={line.variant.compareAtPoisha} />
                      </span>
                    ) : null}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center rounded-md border border-border">
                      <button
                        type="button"
                        aria-label="পরিমাণ কমান"
                        disabled={line.item.quantity <= 1}
                        onClick={() => setQuantity(line.item.variantId, line.item.quantity - 1)}
                        className="flex h-11 w-11 items-center justify-center text-lg disabled:opacity-40"
                      >
                        −
                      </button>
                      <span className="w-10 text-center text-sm font-medium tabular-nums" aria-label="পরিমাণ">
                        {line.item.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label="পরিমাণ বাড়ান"
                        disabled={line.outOfStock || line.item.quantity >= line.stockCap}
                        onClick={() => setQuantity(line.item.variantId, line.item.quantity + 1)}
                        className="flex h-11 w-11 items-center justify-center text-lg disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                    {line.outOfStock ? (
                      <span className="text-xs font-medium text-rose-500">স্টক শেষ</span>
                    ) : line.item.quantity >= line.stockCap ? (
                      <span className="text-xs text-text-muted">স্টকে যা আছে সব নেওয়া হয়েছে</span>
                    ) : null}
                    <span className="ml-auto text-sm font-semibold">
                      <Money bengaliDigits={bengaliDigits} poisha={line.item.unitPricePoisha * line.item.quantity} />
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => saveForLater(line.item.variantId)}>
                      পরে কেনার জন্য রাখুন
                    </Button>
                    <Button size="sm" variant="ghost" className="text-rose-500" onClick={() => removeItem(line.item.variantId)}>
                      সরিয়ে দিন
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Link href="/shop" className="text-sm font-medium text-brand-700 hover:underline">
              ← আরও কেনাকাটা করুন
            </Link>
            <Button size="sm" variant="outline" className="ml-auto" onClick={clearCart}>
              কার্ট খালি করুন
            </Button>
          </div>
        </div>

        {/* Summary */}
        <Card className="h-fit">
          <h2 className="text-base font-semibold">হিসাবের সারাংশ</h2>

          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-text-muted">ডেলিভারি এলাকা</p>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="ডেলিভারি এলাকা">
              {CART_SHIPPING_ZONES.map((z) => (
                <button
                  key={z.id}
                  type="button"
                  role="radio"
                  aria-checked={zoneId === z.id}
                  onClick={() => setZoneId(z.id)}
                  className={`min-h-[44px] rounded-md border px-2 py-2 text-sm ${
                    zoneId === z.id
                      ? "border-brand-500 bg-brand-50 font-semibold text-brand-700"
                      : "border-border text-text-main hover:bg-surface-2"
                  }`}
                >
                  {z.labelBn}
                  <span className="block text-xs text-text-muted"><Money bengaliDigits={bengaliDigits} poisha={z.chargePoisha} /></span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            {savedCouponCode ? (
              <p className="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-sm">
                <span>
                  কুপন <strong>{savedCouponCode}</strong> সংরক্ষিত — চেকআউটে যাচাই হবে
                </span>
                <button type="button" onClick={removeCoupon} className="font-medium text-rose-500">
                  বাতিল
                </button>
              </p>
            ) : (
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    label="কুপন কোড"
                    name="couponCode"
                    placeholder="কুপন কোড লিখুন"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value)}
                  />
                </div>
                <Button variant="secondary" onClick={applyCouponCode}>
                  প্রয়োগ করুন
                </Button>
              </div>
            )}
            {couponMessage ? (
              <p role="status" className="mt-1 text-xs text-text-muted">{couponMessage}</p>
            ) : null}
            <p className="mt-1 text-xs text-text-subtle">কুপন চেকআউটে সার্ভার যাচাই করবে — সঠিক কুপন হলে ছাড় অর্ডারের মোটে প্রয়োগ হবে।</p>
          </div>

          <dl className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-text-muted">সাবটোটাল</dt>
              <dd><Money bengaliDigits={bengaliDigits} poisha={pricing.subtotalPoisha + itemDiscountPoisha} /></dd>
            </div>
            {itemDiscountPoisha > 0 ? (
              <div className="flex justify-between">
                <dt className="text-text-muted">পণ্যের ছাড়</dt>
                <dd className="text-brand-700">−<Money bengaliDigits={bengaliDigits} poisha={itemDiscountPoisha} /></dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-text-muted">ডেলিভারি চার্জ ({zone.labelBn})</dt>
              <dd>
                <Money bengaliDigits={bengaliDigits} poisha={pricing.shippingPoisha} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-muted">ক্যাশ অন ডেলিভারি ফি</dt>
              <dd><Money bengaliDigits={bengaliDigits} poisha={pricing.codFeePoisha} /></dd>
            </div>
            {pricing.taxPoisha > 0 ? (
              <div className="flex justify-between">
                <dt className="text-text-muted">ভ্যাট/ট্যাক্স</dt>
                <dd><Money bengaliDigits={bengaliDigits} poisha={pricing.taxPoisha} /></dd>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
              <dt>সর্বমোট</dt>
              <dd><Money bengaliDigits={bengaliDigits} poisha={pricing.grandTotalPoisha} /></dd>
            </div>
          </dl>

          <p className="mt-2 text-xs text-text-subtle">
            এটি প্রিভিউ হিসাব — চেকআউটে দাম ও স্টক আবার যাচাই হবে।
          </p>

          <Link href="/checkout" className="mt-4 block">
            <Button variant="gradient" size="lg" className="w-full">
              চেকআউট করুন
            </Button>
          </Link>

          {/* Cart-share (ADV-19): mint a signed, 7-day link carrying
              only variant ids + quantities. The recipient's page
              re-resolves prices/stock live. */}
          <div className="mt-3 border-t border-border pt-3">
            <Button
              variant="secondary"
              className="w-full"
              disabled={shareBusy || !cart || cart.items.length === 0}
              onClick={() => {
                if (!cart) return;
                setShareBusy(true);
                setShareMessage(null);
                void fetch("/api/v1/public/cart-share", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    lines: cart.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
                  }),
                })
                  .then(async (res) => {
                    const json = (await res.json().catch(() => ({}))) as {
                      data?: { path?: string };
                      error?: { message?: string };
                    };
                    if (!res.ok || !json.data?.path) {
                      setShareMessage(json.error?.message ?? "শেয়ার লিংক তৈরি করা যায়নি।");
                      return;
                    }
                    setShareUrl(`${window.location.origin}${json.data.path}`);
                  })
                  .catch(() => setShareMessage("সার্ভারের সঙ্গে যোগাযোগ করা যায়নি।"))
                  .finally(() => setShareBusy(false));
              }}
            >
              {shareBusy ? "লিংক তৈরি হচ্ছে…" : "কার্ট শেয়ার করুন"}
            </Button>
            {shareUrl ? (
              <div className="mt-2 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-muted" title={shareUrl}>
                  {shareUrl}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(shareUrl)
                      .then(() => setShareMessage("লিংক কপি হয়েছে — ৭ দিন মেয়াদ থাকবে।"))
                      .catch(() => setShareMessage("কপি করা যায়নি — লিংকটি হাতে কপি করুন।"));
                  }}
                  className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-card px-3 text-sm font-medium text-text-main transition hover:bg-surface-2"
                >
                  কপি করুন
                </button>
              </div>
            ) : null}
            {shareMessage ? (
              <p role="status" className="mt-1.5 text-xs text-text-muted">{shareMessage}</p>
            ) : null}
          </div>
          <Link
            href="/shop"
            className="mt-2 block text-center text-sm font-medium text-brand-700 hover:underline"
          >
            কেনাকাটা চালিয়ে যান
          </Link>
        </Card>
      </div>

      {/* Sticky total + checkout bar — small screens only, directly
          above the shell's mobile bottom nav. Desktop keeps the summary
          card's own checkout button. */}
      <div className="fixed inset-x-0 bottom-16 z-40 border-t border-border bg-card/95 px-4 py-3 shadow-[0_-4px_16px_rgba(49,46,129,0.08)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-text-muted">সর্বমোট ({zone.labelBn} ডেলিভারিসহ)</p>
            <p className="text-base font-bold leading-6">
              <Money bengaliDigits={bengaliDigits} poisha={pricing.grandTotalPoisha} />
            </p>
          </div>
          <Link
            href="/checkout"
            className="brand-gradient flex h-12 shrink-0 items-center rounded-xl px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
          >
            চেকআউট করুন
          </Link>
        </div>
      </div>
    </main>
  );
}
