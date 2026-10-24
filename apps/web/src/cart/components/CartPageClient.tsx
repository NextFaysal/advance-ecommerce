"use client";

// Cart page client — Agent 33 (Storefront Cart Page).
// State: the existing guest cart (src/cart/persistence, localStorage).
// When no guest cart exists yet, a TEMPORARY DEMO cart built from the
// TEMPORARY MOCK catalog is shown (labelled); the first edit persists it
// as the real guest cart. Totals preview uses the same pipeline order as
// checkout: subtotal -> item discounts -> coupon -> shipping -> COD fee
// -> tax -> grand total, computed with checkout/pricing computePricing().
// Coupon rules run through marketing/service applyCoupon() on DEMO coupon
// records (labelled) until a live coupon read exists. Checkout still
// re-validates every price/stock server-side.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { computePricing } from "@/checkout/pricing";
import { getWishlistIds, toggleWishlistId } from "@/catalog/wishlist";
import { applyCoupon, type CouponRecord } from "@/marketing/service";
import {
  clearGuestCart,
  loadGuestCart,
  saveGuestCart,
} from "../persistence";
import { cartSubtotalPoisha, type Cart } from "../types";
import {
  CART_SHIPPING_ZONES,
  COUPON_REASON_BN,
  buildDemoCart,
  cartItemDiscountPoisha,
  findDemoCoupon,
  resolveCartLines,
  type CartShippingZone,
} from "./resolve";

type CouponState = {
  record: CouponRecord;
  discountPoisha: number;
  shippingPoisha: number;
} | null;

export default function CartPageClient() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [isDemoCart, setIsDemoCart] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [zoneId, setZoneId] = useState<CartShippingZone["id"]>("inside_dhaka");
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<CouponState>(null);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const guest = loadGuestCart();
    if (guest && guest.items.length > 0) {
      setCart(guest);
      setIsDemoCart(false);
      if (guest.couponCode) setCouponInput(guest.couponCode);
    } else {
      setCart(buildDemoCart());
      setIsDemoCart(true);
    }
    setLoaded(true);
  }, []);

  const lines = useMemo(() => (cart ? resolveCartLines(cart) : []), [cart]);
  const zone =
    CART_SHIPPING_ZONES.find((z) => z.id === zoneId) ?? CART_SHIPPING_ZONES[0]!;

  const subtotalPoisha = cart ? cartSubtotalPoisha(cart) : 0;
  const itemDiscountPoisha = cartItemDiscountPoisha(lines);
  const afterItemDiscountPoisha = Math.max(0, subtotalPoisha - itemDiscountPoisha);

  // Re-evaluate the applied coupon whenever the cart value changes: a
  // coupon that no longer qualifies (e.g. min cart) drops off visibly.
  const couponEval = useMemo(() => {
    if (!coupon) return null;
    const result = applyCoupon(coupon.record, {
      code: coupon.record.code,
      subtotalPoisha: afterItemDiscountPoisha,
      shippingPoisha: zone.chargePoisha,
      isFirstOrder: false,
      alreadyAppliedCodes: [],
    });
    return result.eligible ? result : null;
  }, [coupon, afterItemDiscountPoisha, zone.chargePoisha]);

  const pricing = computePricing({
    itemsSubtotalPoisha: afterItemDiscountPoisha,
    couponDiscountPoisha: couponEval?.discountPoisha ?? 0,
    shippingPoisha: couponEval ? couponEval.shippingPoisha : zone.chargePoisha,
    // COD fee is 0 in the current pricing config (same as /checkout demo);
    // the row stays in the breakdown so the pipeline order is visible.
    codFeePoisha: 0,
    taxBps: 0,
  });

  function persist(next: Cart) {
    const withTime = { ...next, updatedAt: new Date().toISOString() };
    setCart(withTime);
    if (withTime.ownerType === "guest") saveGuestCart(withTime);
    setIsDemoCart(false);
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
    setCoupon(null);
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

  function applyCouponCode() {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    const record = findDemoCoupon(code);
    if (!record) {
      setCoupon(null);
      setCouponMessage(COUPON_REASON_BN.not_found ?? "কুপন কোড পাওয়া যায়নি।");
      return;
    }
    const result = applyCoupon(record, {
      code: record.code,
      subtotalPoisha: afterItemDiscountPoisha,
      shippingPoisha: zone.chargePoisha,
      isFirstOrder: false,
      alreadyAppliedCodes: [],
    });
    if (!result.eligible) {
      setCoupon(null);
      setCouponMessage(
        (result.reason && COUPON_REASON_BN[result.reason]) ?? "কুপনটি ব্যবহার করা যাচ্ছে না।",
      );
      return;
    }
    setCoupon({ record, discountPoisha: result.discountPoisha, shippingPoisha: result.shippingPoisha });
    setCouponMessage(`কুপন ${record.code} প্রয়োগ হয়েছে।`);
    if (cart) persist({ ...cart, couponCode: record.code });
  }

  function removeCoupon() {
    setCoupon(null);
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
          TEMPORARY DEMO — পণ্যের তথ্য mock catalog থেকে আসে; কার্ট এই ব্রাউজারেই সংরক্ষিত থাকে।
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
    <main className="mx-auto min-w-0 max-w-7xl px-4 py-6">
      <h1 className="text-xl font-bold">আপনার কার্ট</h1>
      <p className="mt-1 text-xs text-text-subtle">
        TEMPORARY DEMO — পণ্যের তথ্য mock catalog থেকে আসে; কার্ট এই ব্রাউজারেই সংরক্ষিত থাকে।
        {isDemoCart ? " এটি একটি ডেমো কার্ট — দোকান থেকে পণ্য যোগ করলে আপনার আসল কার্ট দেখাবে।" : ""}
      </p>

      {notice ? (
        <p role="status" className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">
          {notice}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Line items */}
        <div className="min-w-0">
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {lines.map((line) => (
              <li key={line.item.variantId} className="flex gap-3 p-3 sm:gap-4 sm:p-4">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-surface-2 px-1 text-center text-xs text-text-muted">
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
                  <p className="mt-1 text-sm">
                    <Money poisha={line.item.unitPricePoisha} />
                    {line.discountPoishaPerUnit > 0 && line.variant?.compareAtPoisha ? (
                      <span className="ml-2 text-text-subtle line-through">
                        <Money poisha={line.variant.compareAtPoisha} />
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
                        className="flex h-10 w-10 items-center justify-center text-lg disabled:opacity-40"
                      >
                        −
                      </button>
                      <span className="w-8 text-center text-sm font-medium tabular-nums" aria-label="পরিমাণ">
                        {line.item.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label="পরিমাণ বাড়ান"
                        disabled={line.outOfStock || line.item.quantity >= line.stockCap}
                        onClick={() => setQuantity(line.item.variantId, line.item.quantity + 1)}
                        className="flex h-10 w-10 items-center justify-center text-lg disabled:opacity-40"
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
                      <Money poisha={line.item.unitPricePoisha * line.item.quantity} />
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
                  <span className="block text-xs text-text-muted"><Money poisha={z.chargePoisha} /></span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            {coupon && couponEval ? (
              <p className="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-sm">
                <span>
                  কুপন <strong>{coupon.record.code}</strong> চালু আছে
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
                    placeholder="WELCOME10"
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
            <p className="mt-1 text-xs text-text-subtle">ডেমো কুপন — আসল কুপন যাচাই চেকআউটে সার্ভার করবে।</p>
          </div>

          <dl className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-text-muted">সাবটোটাল</dt>
              <dd><Money poisha={pricing.subtotalPoisha + itemDiscountPoisha} /></dd>
            </div>
            {itemDiscountPoisha > 0 ? (
              <div className="flex justify-between">
                <dt className="text-text-muted">পণ্যের ছাড়</dt>
                <dd className="text-brand-700">−<Money poisha={itemDiscountPoisha} /></dd>
              </div>
            ) : null}
            {pricing.couponDiscountPoisha > 0 ? (
              <div className="flex justify-between">
                <dt className="text-text-muted">কুপন ছাড় {coupon ? `(${coupon.record.code})` : ""}</dt>
                <dd className="text-brand-700">−<Money poisha={pricing.couponDiscountPoisha} /></dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-text-muted">ডেলিভারি চার্জ ({zone.labelBn})</dt>
              <dd>
                {couponEval && couponEval.shippingPoisha === 0 && zone.chargePoisha > 0 ? (
                  <span className="font-medium text-brand-700">ফ্রি</span>
                ) : (
                  <Money poisha={pricing.shippingPoisha} />
                )}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-muted">ক্যাশ অন ডেলিভারি ফি</dt>
              <dd><Money poisha={pricing.codFeePoisha} /></dd>
            </div>
            {pricing.taxPoisha > 0 ? (
              <div className="flex justify-between">
                <dt className="text-text-muted">ভ্যাট/ট্যাক্স</dt>
                <dd><Money poisha={pricing.taxPoisha} /></dd>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
              <dt>সর্বমোট</dt>
              <dd><Money poisha={pricing.grandTotalPoisha} /></dd>
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
          <Link
            href="/shop"
            className="mt-2 block text-center text-sm font-medium text-brand-700 hover:underline"
          >
            কেনাকাটা চালিয়ে যান
          </Link>
        </Card>
      </div>
    </main>
  );
}
