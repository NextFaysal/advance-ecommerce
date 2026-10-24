"use client";

// Checkout — wired to the REAL cart and the REAL orders API.
// Cart source of truth: the guest cart in localStorage via
// src/cart/persistence (loadGuestCart / clearGuestCart) — the exact
// same store the cart page reads and AddToCartButton writes. There is
// no second cart: the in-memory /api/v1/public/carts Map is not used by
// any storefront page and is deliberately not used here either.
// Submit: POST /api/v1/public/orders with the validateCheckoutForm()
// output (the route parses the same checkoutFormSchema). The client
// sends NO prices — the server re-reads variant prices/stock from the
// DB; the totals below are a preview of the server's own pipeline
// (shipping: inside_dhaka 6000 / outside_dhaka 12000 / pickup 0 poisha,
// exactly as the orders route; a coupon's discount is evaluated
// server-side only, so the preview carries 0 until the order returns).
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Cart } from "../../../src/cart/types";
import { cartSubtotalPoisha } from "../../../src/cart/types";
import { clearGuestCart, loadGuestCart } from "../../../src/cart/persistence";
import { findStockProblems } from "../../../src/checkout/stock";
import { computePricing, formatBdt } from "../../../src/checkout/pricing";
import { newIdempotencyKey, validateCheckoutForm } from "../../../src/checkout";
import { BkashMark, CodMark, NagadMark, SslCommerzMark } from "@/components/brand-marks";
import { Icon } from "@/components/ui/icon";

// Responsive pass (Design v3 §3): single-column flow at every width,
// 44px+ touch targets (h-12 fields, 52px payment tiles), numeric keypad
// hint on the phone field, and a sticky order-summary bar on small
// screens (real cart totals). Field names/values and validation are
// exactly as before.
const INPUT_CLASS =
  "h-12 w-full rounded-xl border border-border bg-card px-4 text-sm text-text-main outline-none transition placeholder:text-text-subtle focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";
const PAYMENT_TILE_CLASS =
  "inline-flex h-[52px] cursor-pointer items-center gap-2 rounded-xl border border-border bg-card px-3 transition has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:checked]:ring-1 has-[:checked]:ring-brand-500/40";

/** Display-only mirror of the orders route's shipping charges (poisha). */
const SHIPPING_POISHA: Record<string, number> = {
  inside_dhaka: 6000,
  outside_dhaka: 12000,
  pickup: 0,
};

type PlacedOrder = {
  orderNo: string;
  totalPoisha: number;
  paymentMethod: string;
  advanceRequired: boolean;
  requiresOtp: boolean;
  couponStatus?: string;
};

export default function CheckoutPage() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [placedOrder, setPlacedOrder] = useState<PlacedOrder | null>(null);
  // Display-only mirror of the shipping <select> so the summary totals
  // follow the chosen zone; the submitted value still comes from the
  // form itself (name/defaultValue unchanged).
  const [shippingMethod, setShippingMethod] = useState<string>("inside_dhaka");
  // One key per checkout attempt; reused on retry, never regenerated on retry.
  const [idempotencyKey] = useState<string>(() => newIdempotencyKey());

  useEffect(() => {
    setCart(loadGuestCart());
    setLoaded(true);
  }, []);

  const items = useMemo(() => cart?.items ?? [], [cart]);
  const stockProblems = useMemo(() => findStockProblems(items), [items]);
  const totalQuantity = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items],
  );
  const pricing = useMemo(
    () =>
      computePricing({
        itemsSubtotalPoisha: cart ? cartSubtotalPoisha(cart) : 0,
        couponDiscountPoisha: 0,
        shippingPoisha: SHIPPING_POISHA[shippingMethod] ?? 6000,
        codFeePoisha: 0,
        taxBps: 0,
      }),
    [cart, shippingMethod],
  );

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!cart || submitting) return;
    const data = new FormData(e.currentTarget);
    const result = validateCheckoutForm({
      customerName: data.get("customerName"),
      phone: data.get("phone"),
      email: data.get("email") ?? "",
      address: {
        division: data.get("division"),
        district: data.get("district"),
        upazila: data.get("upazila"),
        union: data.get("union") || undefined,
        addressLine: data.get("addressLine"),
      },
      note: data.get("note") ?? undefined,
      shippingMethod: data.get("shippingMethod"),
      paymentMethod: data.get("paymentMethod"),
      items: cart.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
      idempotencyKey,
      couponCode: data.get("couponCode") || undefined,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/public/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.data),
      });
      const json = (await res.json().catch(() => null)) as {
        data?: {
          order?: {
            orderNo?: string;
            totalPoisha?: number;
            paymentMethod?: string;
            advanceRequired?: boolean;
            requiresOtp?: boolean;
            couponStatus?: string;
          };
        };
        error?: { code?: string; message?: string; details?: unknown };
      } | null;
      const order = json?.data?.order;
      if (res.ok && order?.orderNo) {
        // Order persisted server-side (201, or 200 on an idempotent
        // replay of the same key) — the cart is spent: clear it via the
        // cart system's own mechanism so the cart page agrees.
        clearGuestCart();
        setCart(null);
        setPlacedOrder({
          orderNo: order.orderNo,
          totalPoisha: order.totalPoisha ?? pricing.grandTotalPoisha,
          paymentMethod: order.paymentMethod ?? result.data.paymentMethod,
          advanceRequired: Boolean(order.advanceRequired),
          requiresOtp: Boolean(order.requiresOtp),
          couponStatus: order.couponStatus,
        });
        return;
      }
      const apiError = json?.error;
      if (apiError?.code === "IDEMPOTENCY_CONFLICT") {
        // The key was claimed by an earlier failed attempt in this
        // session (the server keeps failed claims), so this key can
        // never succeed — a fresh page load mints a new key.
        setErrors([
          "এই চেকআউট প্রচেষ্টাটি আগেই একবার প্রসেস হয়েছে। নতুন করে অর্ডার করতে পেজটি রিলোড করুন।",
        ]);
      } else if (apiError?.code === "VALIDATION_ERROR" && Array.isArray(apiError.details)) {
        setErrors(apiError.details.map((d) => String(d)));
      } else if (apiError?.message) {
        setErrors([apiError.message]);
      } else {
        setErrors(["অর্ডার করা যায়নি। আবার চেষ্টা করুন।"]);
      }
    } catch {
      setErrors(["নেটওয়ার্ক সমস্যা — সংযোগ যাচাই করে আবার চেষ্টা করুন।"]);
    } finally {
      setSubmitting(false);
    }
  }

  // The sticky summary bar never submits anything itself — it scrolls to
  // (and focuses) the one real submit button, so validation, the
  // idempotency key, and the stock guard all stay in a single place.
  function scrollToSubmit() {
    const el = document.getElementById("checkout-submit");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => el.focus({ preventScroll: true }), 350);
  }

  if (!loaded) {
    return (
      <main className="mx-auto w-full max-w-[720px] px-4 pb-32 pt-6 sm:px-6 lg:pb-12">
        <h1 className="font-display text-h1">চেকআউট — এক পেজেই অর্ডার</h1>
        <p className="mt-4 text-sm text-text-muted">কার্ট লোড হচ্ছে…</p>
      </main>
    );
  }

  if (placedOrder) {
    return (
      <main className="mx-auto w-full max-w-[720px] px-4 pb-32 pt-6 sm:px-6 lg:pb-12">
        <section className="rounded-2xl border border-border bg-card p-6 text-center shadow-card" aria-label="অর্ডার সফল">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <Icon name="check" size={28} strokeWidth={2} />
          </span>
          <h1 className="font-display mt-4 text-h1">অর্ডার সফল হয়েছে!</h1>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            ধন্যবাদ! আপনার অর্ডারটি গ্রহণ করা হয়েছে।
          </p>
          <dl className="mx-auto mt-5 max-w-sm space-y-2 rounded-xl bg-surface-2 px-4 py-3 text-left text-sm">
            <div className="flex justify-between">
              <dt className="text-text-muted">অর্ডার নম্বর</dt>
              <dd className="font-semibold tabular-nums">{placedOrder.orderNo}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-muted">সর্বমোট</dt>
              <dd className="font-semibold tabular-nums">{formatBdt(placedOrder.totalPoisha)}</dd>
            </div>
          </dl>
          {placedOrder.paymentMethod === "cod" ? (
            <p className="mt-4 text-sm leading-6 text-text-muted">
              পণ্য হাতে পেয়ে ডেলিভারি ম্যানকে <strong>{formatBdt(placedOrder.totalPoisha)}</strong> পরিশোধ করুন।
            </p>
          ) : (
            <p className="mt-4 text-sm leading-6 text-text-muted">
              অনলাইন পেমেন্ট সম্পন্ন না হলে আমাদের টিম ফোনে যোগাযোগ করে পেমেন্টের ধাপ জানিয়ে দেবে।
            </p>
          )}
          {placedOrder.advanceRequired || placedOrder.requiresOtp ? (
            <p role="status" className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
              নিরাপত্তা যাচাইয়ের জন্য এই অর্ডারে অগ্রিম পেমেন্ট বা ফোন যাচাই (OTP) লাগতে পারে — আমাদের টিম যোগাযোগ করবে।
            </p>
          ) : null}
          {placedOrder.couponStatus === "applied" ? (
            <p className="mt-3 text-sm font-medium text-emerald-700">আপনার কুপনটি প্রয়োগ হয়েছে — ছাড়সহ মোট উপরে দেখানো হয়েছে।</p>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link
              href="/track"
              className="brand-gradient flex h-12 items-center rounded-xl px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
            >
              অর্ডার ট্র্যাক করুন
            </Link>
            <Link
              href="/shop"
              className="flex h-12 items-center rounded-xl border border-border bg-card px-5 text-sm font-semibold text-text-main transition hover:bg-surface-2"
            >
              দোকানে যান
            </Link>
          </div>
        </section>
      </main>
    );
  }

  if (!cart || items.length === 0) {
    return (
      <main className="mx-auto w-full max-w-[720px] px-4 pb-32 pt-6 sm:px-6 lg:pb-12">
        <h1 className="font-display text-h1">চেকআউট — এক পেজেই অর্ডার</h1>
        <section className="mt-6 rounded-2xl border border-border bg-card px-4 py-10 text-center shadow-card" aria-label="কার্ট খালি">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <Icon name="cart" size={26} />
          </span>
          <p className="mt-4 text-base font-semibold text-text-main">আপনার কার্ট খালি</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-text-muted">
            চেকআউট করতে আগে কার্টে পণ্য যোগ করুন — পছন্দের পণ্য বেছে কার্টে যোগ করলেই এখানে অর্ডার করা যাবে।
          </p>
          <Link
            href="/shop"
            className="brand-gradient mt-5 inline-flex h-12 items-center rounded-xl px-6 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
          >
            দোকানে যান
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-32 pt-6 sm:px-6 lg:pb-12">
      <h1 className="font-display text-h1">চেকআউট — এক পেজেই অর্ডার</h1>
      <p className="mt-2 text-sm leading-6 text-text-muted">
        ফোন নম্বর আবশ্যক, ইমেইল ঐচ্ছিক। ঠিকানা দিন ধাপে ধাপে: বিভাগ › জেলা › উপজেলা › ইউনিয়ন (ঐচ্ছিক)।
      </p>

      <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card" aria-label="আপনার কার্ট">
        <h2 className="text-base font-semibold text-text-main">আপনার কার্ট</h2>
        <ul className="mt-3 divide-y divide-border">
          {items.map((item) => (
            <li key={item.variantId} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0">
                {item.name} <span className="text-text-muted">({item.sku})</span>
                <span className="text-text-muted"> × {item.quantity}</span>
              </span>
              <span className="shrink-0 font-medium tabular-nums">{formatBdt(item.unitPricePoisha * item.quantity)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-text-muted">সাবটোটাল</dt>
            <dd className="tabular-nums">{formatBdt(pricing.subtotalPoisha)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-muted">ডেলিভারি চার্জ</dt>
            <dd className="tabular-nums">{formatBdt(pricing.shippingPoisha)}</dd>
          </div>
          <div className="flex justify-between pt-1 text-base font-bold text-text-main">
            <dt>সর্বমোট</dt>
            <dd className="tabular-nums">{formatBdt(pricing.grandTotalPoisha)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-text-subtle">
          চূড়ান্ত হিসাব সার্ভারে আবার যাচাই হবে — কুপনের ছাড় থাকলে তা অর্ডারের মোটে কমে যাবে।
        </p>
        {stockProblems.length > 0 && (
          <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
            স্টক সমস্যা: {stockProblems.map((p) => `${p.name} (চেয়েছেন ${p.requested}টি, স্টকে আছে ${p.available}টি)`).join(", ")}
          </p>
        )}
      </section>

      <form onSubmit={onSubmit} className="mt-6 grid gap-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">আপনার নাম *</span>
          <input name="customerName" required autoComplete="name" className={INPUT_CLASS} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">মোবাইল নম্বর *</span>
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="01XXXXXXXXX"
            required
            className={INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">ইমেইল (ঐচ্ছিক)</span>
          <input name="email" type="email" inputMode="email" autoComplete="email" className={INPUT_CLASS} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">বিভাগ *</span>
          <input name="division" required className={INPUT_CLASS} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">জেলা *</span>
          <input name="district" required className={INPUT_CLASS} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">উপজেলা *</span>
          <input name="upazila" required className={INPUT_CLASS} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">ইউনিয়ন (ঐচ্ছিক)</span>
          <input name="union" className={INPUT_CLASS} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">বিস্তারিত ঠিকানা *</span>
          <input name="addressLine" required autoComplete="street-address" className={INPUT_CLASS} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">নোট (ঐচ্ছিক)</span>
          <input name="note" className={INPUT_CLASS} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">ডেলিভারি এলাকা</span>
          <select
            name="shippingMethod"
            defaultValue="inside_dhaka"
            onChange={(e) => setShippingMethod(e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="inside_dhaka">ঢাকার ভিতরে</option>
            <option value="outside_dhaka">ঢাকার বাইরে</option>
            <option value="pickup">পিকআপ (নিজে এসে নেবেন)</option>
          </select>
        </label>
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 text-sm font-semibold text-text-main">পেমেন্ট মাধ্যম</legend>
          <div className="flex flex-wrap gap-2">
            <label className={PAYMENT_TILE_CLASS}>
              <input type="radio" name="paymentMethod" value="cod" defaultChecked className="h-4 w-4 shrink-0 accent-brand-600" />
              <CodMark />
            </label>
            <label className={PAYMENT_TILE_CLASS}>
              <input type="radio" name="paymentMethod" value="bkash" className="h-4 w-4 shrink-0 accent-brand-600" />
              <BkashMark />
            </label>
            <label className={PAYMENT_TILE_CLASS}>
              <input type="radio" name="paymentMethod" value="nagad" className="h-4 w-4 shrink-0 accent-brand-600" />
              <NagadMark />
            </label>
            <label className={PAYMENT_TILE_CLASS}>
              <input type="radio" name="paymentMethod" value="sslcommerz" className="h-4 w-4 shrink-0 accent-brand-600" />
              <SslCommerzMark />
            </label>
            <label className={PAYMENT_TILE_CLASS}>
              <input type="radio" name="paymentMethod" value="aamarpay" className="h-4 w-4 shrink-0 accent-brand-600" />
              <span className="text-sm font-semibold text-text-main">AamarPay</span>
            </label>
            <label className={PAYMENT_TILE_CLASS}>
              <input type="radio" name="paymentMethod" value="shurjopay" className="h-4 w-4 shrink-0 accent-brand-600" />
              <span className="text-sm font-semibold text-text-main">ShurjoPay</span>
            </label>
          </div>
          <p className="mt-2.5 text-sm leading-6 text-text-muted">
            নিরাপদ পেমেন্ট: পণ্য হাতে পেয়ে টাকা দিন (ক্যাশ অন ডেলিভারি), অথবা বিকাশ, নগদ ও কার্ডে অনলাইনে পরিশোধ করুন।
          </p>
        </fieldset>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">কুপন কোড (ঐচ্ছিক)</span>
          <input name="couponCode" autoComplete="off" className={INPUT_CLASS} />
        </label>
        <button
          id="checkout-submit"
          type="submit"
          disabled={stockProblems.length > 0 || submitting}
          className="brand-gradient h-12 w-full rounded-xl text-base font-semibold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "অর্ডার করা হচ্ছে…" : "অর্ডার নিশ্চিত করুন"}
        </button>
      </form>

      {errors.length > 0 && (
        <ul role="alert" className="mt-4 space-y-1 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}

      {/* Sticky order-summary bar — small screens only, REAL cart totals.
          Sits directly above the shell's mobile bottom nav (bottom-16);
          the desktop flow keeps the in-page summary + submit, unchanged. */}
      <div className="fixed inset-x-0 bottom-16 z-40 border-t border-border bg-card/95 px-4 py-3 shadow-[0_-4px_16px_rgba(49,46,129,0.08)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-[720px] items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-text-muted">মোট {totalQuantity}টি পণ্য</p>
            <p className="text-base font-bold leading-6 text-text-main">
              সর্বমোট <span className="tabular-nums">{formatBdt(pricing.grandTotalPoisha)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={scrollToSubmit}
            className="brand-gradient flex h-12 shrink-0 items-center gap-1.5 rounded-xl px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
          >
            অর্ডার করুন
            <Icon name="chevron-down" size={16} strokeWidth={2} />
          </button>
        </div>
      </div>
    </main>
  );
}
