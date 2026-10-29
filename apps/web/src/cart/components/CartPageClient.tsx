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
import { useLocale } from "@/i18n/LocaleProvider";
import { useThemeView } from "@/themes/theme-view";
import { interpolate, pick } from "@/i18n/locale";
import {
  clearGuestCart,
  loadGuestCart,
  saveGuestCart,
} from "../persistence";
import { QtyStepper } from "@/storefront-ux/components/CartPrimitives";
import { CartListSkeleton } from "@/storefront-ux/components/StorefrontSkeletons";
import { CART_STRINGS } from "../strings";
import { cartSubtotalPoisha, type Cart } from "../types";
import { addQty, DEFAULT_WEIGHTED_STEP, lineTotalPoisha, qtyNumber, qtyToString, subQty } from "@/lib/quantity";
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
  /** Wave 59: fractional stepper step in pack units (server-computed
   *  from the pack's weight step). Absent on older payloads — the
   *  stepper then falls back to the 0.5 default step. */
  stepQuantity?: number;
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
  const { locale, t } = useLocale();
  const s = pick(locale, CART_STRINGS);
  // Only the Aurora shell renders a mobile bottom nav; the sticky
  // bar below must clear it (bottom-16) under Aurora and sit on the
  // bottom edge (bottom-0 + safe-area) under every other shell.
  const shellIsAurora = useThemeView().packageId === "aurora";
  const zoneLabel = (z: CartShippingZone) => (locale === "bn" ? z.labelBn : z.labelEn);
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
    // Wave 59: weighted lines step fractionally from their step size
    // (0.5 default when the payload predates stepQuantity); every
    // other line keeps whole-unit stepping from 1.
    const annotation = weightedVariants?.[variantId];
    const min = annotation ? (annotation.stepQuantity ?? DEFAULT_WEIGHTED_STEP) : 1;
    const cap = line ? Math.max(min, line.stockCap) : quantity;
    const clamped = Math.min(Math.max(min, qtyNumber(quantity)), cap);
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
    setNotice(s.itemRemovedNotice);
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
    setNotice(already ? s.alreadyInWishlistNotice : s.savedToWishlistNotice);
  }

  // Stores the code on the cart only — no client-side resolution
  // exists (no public coupon API). The server evaluates the code
  // against the real DB coupons when the order is created; a wrong or
  // ineligible code is reported on the checkout confirmation.
  function applyCouponCode() {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    setSavedCouponCode(code);
    setCouponMessage(interpolate(s.couponSavedMessage, { code }));
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
        <h1 className="text-xl font-bold">{s.yourCart}</h1>
        <p className="sr-only" role="status">{s.cartLoading}</p>
        {/* Skeleton rows (doc 32 P1/P3) in the list's card frame —
            same geometry the loaded list renders in. */}
        <div className="mt-4 rounded-xl border border-border bg-card px-4 shadow-card">
          <CartListSkeleton rows={3} />
        </div>
      </main>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <main className="mx-auto min-w-0 max-w-7xl px-4 py-6">
        <h1 className="text-xl font-bold">{s.yourCart}</h1>
        <p className="mt-1 text-xs text-text-subtle">
          {s.catalogNote}
        </p>
        <div className="mt-8 rounded-xl border bg-card px-4 py-10 text-center">
          <p aria-hidden="true" className="text-4xl">🛒</p>
          <p className="mt-3 font-medium">{s.cartEmpty}</p>
          <p className="mt-1 text-sm text-text-muted">{s.cartEmptyHint}</p>
          <Link
            href="/shop"
            className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white"
          >
            {s.startShopping}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-w-0 max-w-7xl px-4 pb-32 pt-6 lg:pb-6">
      <h1 className="text-xl font-bold">{s.yourCart}</h1>
      <p className="mt-1 text-xs text-text-subtle">
        {s.catalogNote}
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
                      ⚖️ {interpolate(s.weightedPack, { grams: weightedVariants[line.item.variantId]!.packGrams })}{" "}
                      <Money
                        bengaliDigits={bengaliDigits}
                        poisha={weightedVariants[line.item.variantId]!.pricePerKgPoisha}
                      />
                      {weightedVariants[line.item.variantId]!.inSync ? (
                        <>
                          {" "}· {s.packPrice}{" "}
                          <Money
                            bengaliDigits={bengaliDigits}
                            poisha={weightedVariants[line.item.variantId]!.derivedPricePoisha}
                          />
                        </>
                      ) : (
                        <span className="text-text-subtle"> · {s.packPricePending}</span>
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
                    {(() => {
                      // Wave 59: weighted lines step by their pack step
                      // (min = one step); other lines step by 1 from 1.
                      const annotation = weightedVariants?.[line.item.variantId];
                      const step = annotation ? (annotation.stepQuantity ?? DEFAULT_WEIGHTED_STEP) : 1;
                      const minQty = step;
                      return (
                        /* Shared QtyStepper (doc 32 P1) — comfortable
                           density reproduces this stepper's exact
                           markup; stepping rules stay above. */
                        <QtyStepper
                          value={qtyToString(line.item.quantity)}
                          valueLabel={t.quantity}
                          decreaseLabel={s.decreaseQuantity}
                          increaseLabel={s.increaseQuantity}
                          decreaseDisabled={line.item.quantity <= minQty}
                          increaseDisabled={line.outOfStock || line.item.quantity >= line.stockCap}
                          onDecrease={() => setQuantity(line.item.variantId, subQty(line.item.quantity, step))}
                          onIncrease={() => setQuantity(line.item.variantId, addQty(line.item.quantity, step))}
                        />
                      );
                    })()}
                    {line.outOfStock ? (
                      <span className="text-xs font-medium text-rose-500">{t.outOfStock}</span>
                    ) : line.item.quantity >= line.stockCap ? (
                      <span className="text-xs text-text-muted">{s.allStockTaken}</span>
                    ) : null}
                    <span className="ml-auto text-sm font-semibold">
                      <Money bengaliDigits={bengaliDigits} poisha={lineTotalPoisha(line.item.unitPricePoisha, line.item.quantity)} />
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => saveForLater(line.item.variantId)}>
                      {s.saveForLater}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-rose-500" onClick={() => removeItem(line.item.variantId)}>
                      {s.removeItem}
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Link href="/shop" className="text-sm font-medium text-brand-700 hover:underline">
              {s.backToShopping}
            </Link>
            <Button size="sm" variant="outline" className="ml-auto" onClick={clearCart}>
              {s.clearCart}
            </Button>
          </div>
        </div>

        {/* Summary — sticky under the shell header on desktop
            (same offset the shop chrome uses); on phone it stacks
            below the lines and the sticky bottom bar carries the
            total + checkout instead. */}
        <Card className="h-fit lg:sticky lg:top-[9.5rem] lg:self-start">
          <h2 className="text-base font-semibold">{s.orderSummary}</h2>

          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-text-muted">{s.deliveryArea}</p>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={s.deliveryArea}>
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
                  {zoneLabel(z)}
                  <span className="block text-xs text-text-muted"><Money bengaliDigits={bengaliDigits} poisha={z.chargePoisha} /></span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            {savedCouponCode ? (
              <p className="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-sm">
                <span>
                  {s.couponSavedPrefix} <strong>{savedCouponCode}</strong> {s.couponSavedSuffix}
                </span>
                <button type="button" onClick={removeCoupon} className="font-medium text-rose-500">
                  {t.cancel}
                </button>
              </p>
            ) : (
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    label={s.couponCode}
                    name="couponCode"
                    placeholder={s.couponCodePlaceholder}
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value)}
                  />
                </div>
                <Button variant="secondary" onClick={applyCouponCode}>
                  {s.applyCoupon}
                </Button>
              </div>
            )}
            {couponMessage ? (
              <p role="status" className="mt-1 text-xs text-text-muted">{couponMessage}</p>
            ) : null}
            <p className="mt-1 text-xs text-text-subtle">{s.couponNote}</p>
          </div>

          <dl className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-text-muted">{t.subtotal}</dt>
              <dd><Money bengaliDigits={bengaliDigits} poisha={pricing.subtotalPoisha + itemDiscountPoisha} /></dd>
            </div>
            {itemDiscountPoisha > 0 ? (
              <div className="flex justify-between">
                <dt className="text-text-muted">{s.itemDiscount}</dt>
                <dd className="text-brand-700">−<Money bengaliDigits={bengaliDigits} poisha={itemDiscountPoisha} /></dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-text-muted">{t.deliveryCharge} ({zoneLabel(zone)})</dt>
              <dd>
                <Money bengaliDigits={bengaliDigits} poisha={pricing.shippingPoisha} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-muted">{s.codFee}</dt>
              <dd><Money bengaliDigits={bengaliDigits} poisha={pricing.codFeePoisha} /></dd>
            </div>
            {pricing.taxPoisha > 0 ? (
              <div className="flex justify-between">
                <dt className="text-text-muted">{s.vatTax}</dt>
                <dd><Money bengaliDigits={bengaliDigits} poisha={pricing.taxPoisha} /></dd>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
              <dt>{s.grandTotal}</dt>
              <dd><Money bengaliDigits={bengaliDigits} poisha={pricing.grandTotalPoisha} /></dd>
            </div>
          </dl>

          <p className="mt-2 text-xs text-text-subtle">
            {s.previewNote}
          </p>

          <Link href="/checkout" className="mt-4 block">
            <Button variant="gradient" size="lg" className="w-full">
              {s.proceedToCheckout}
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
                      setShareMessage(json.error?.message ?? s.shareFailed);
                      return;
                    }
                    setShareUrl(`${window.location.origin}${json.data.path}`);
                  })
                  .catch(() => setShareMessage(s.shareServerError))
                  .finally(() => setShareBusy(false));
              }}
            >
              {shareBusy ? s.shareCreating : s.shareCart}
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
                      .then(() => setShareMessage(s.linkCopied))
                      .catch(() => setShareMessage(s.copyFailed));
                  }}
                  className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-card px-3 text-sm font-medium text-text-main transition hover:bg-surface-2"
                >
                  {s.copyLink}
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
            {s.continueShopping}
          </Link>
        </Card>
      </div>

      {/* Sticky total + checkout bar — small screens only. Under the
          Aurora shell it sits directly above that shell's mobile
          bottom nav (bottom-16); under every other shell there is no
          bottom nav, so it anchors to the bottom edge with safe-area
          padding. Desktop keeps the summary card's own checkout
          button. */}
      <div
        className={`fixed inset-x-0 z-40 border-t border-border bg-card/95 px-4 shadow-[0_-4px_16px_rgba(49,46,129,0.08)] backdrop-blur lg:hidden ${
          shellIsAurora
            ? "bottom-16 py-3"
            : "bottom-0 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-text-muted">{interpolate(s.totalWithDelivery, { zone: zoneLabel(zone) })}</p>
            <p className="text-base font-bold leading-6">
              <Money bengaliDigits={bengaliDigits} poisha={pricing.grandTotalPoisha} />
            </p>
          </div>
          <Link
            href="/checkout"
            className="brand-gradient flex h-12 shrink-0 items-center rounded-xl px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
          >
            {s.proceedToCheckout}
          </Link>
        </div>
      </div>
    </main>
  );
}
