"use client";

// TEMPORARY MOCK cart — replace with real cart (server cart / guest cart merge)
// when the API owner wires /api/v1/public/carts. Prices here are display-only;
// the server must re-validate prices + stock before creating an order.
import { useMemo, useState } from "react";
import type { Cart } from "../../../src/cart/types";
import { cartSubtotalPoisha } from "../../../src/cart/types";
import { findStockProblems } from "../../../src/checkout/stock";
import { computePricing, formatBdt } from "../../../src/checkout/pricing";
import { newIdempotencyKey, validateCheckoutForm } from "../../../src/checkout";
import { BkashMark, CodMark, NagadMark, SslCommerzMark } from "@/components/brand-marks";
import { Icon } from "@/components/ui/icon";

// Responsive pass (Design v3 §3): single-column flow at every width,
// 44px+ touch targets (h-12 fields, 52px payment tiles), numeric keypad
// hint on the phone field, and a sticky order-summary bar on small
// screens. Presentation only — field names/values and validation are
// exactly as before.
const INPUT_CLASS =
  "h-12 w-full rounded-xl border border-border bg-card px-4 text-sm text-text-main outline-none transition placeholder:text-text-subtle focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";
const PAYMENT_TILE_CLASS =
  "inline-flex h-[52px] cursor-pointer items-center gap-2 rounded-xl border border-border bg-card px-3 transition has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:checked]:ring-1 has-[:checked]:ring-brand-500/40";

const MOCK_CART: Cart = {
  ownerKey: "guest-demo",
  ownerType: "guest",
  items: [
    { variantId: "var-1", productId: "prod-1", name: "Cotton Panjabi", sku: "PNJ-BLK-M", unitPricePoisha: 149900, quantity: 1, availableStock: 12 },
    { variantId: "var-2", productId: "prod-1", name: "Cotton Panjabi", sku: "PNJ-WHT-L", unitPricePoisha: 149900, quantity: 1, availableStock: 8 },
  ],
  updatedAt: "2026-10-24T06:00:00.000Z",
};

export default function CheckoutPage() {
  const [cart] = useState<Cart>(MOCK_CART);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  // One key per checkout attempt; reused on retry, never regenerated on retry.
  const [idempotencyKey] = useState<string>(() => newIdempotencyKey());

  const stockProblems = useMemo(() => findStockProblems(cart.items), [cart]);
  const totalQuantity = useMemo(
    () => cart.items.reduce((sum, item) => sum + item.quantity, 0),
    [cart],
  );
  const pricing = useMemo(
    () =>
      computePricing({
        itemsSubtotalPoisha: cartSubtotalPoisha(cart),
        couponDiscountPoisha: 0,
        shippingPoisha: 6000,
        codFeePoisha: 0,
        taxBps: 0,
      }),
    [cart],
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
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
      setSubmitted(false);
      return;
    }
    setErrors([]);
    setSubmitted(true);
    // NEXT STEP (API owner): POST /api/v1/public/orders with result.data.
    // Server must re-validate prices/stock, enforce the idempotency key
    // (DB unique), reserve stock, and create the order in one transaction.
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

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-32 pt-6 sm:px-6 lg:pb-12">
      <h1 className="font-display text-h1">চেকআউট — এক পেজেই অর্ডার</h1>
      <p className="mt-2 text-sm leading-6 text-text-muted">
        ফোন নম্বর আবশ্যক, ইমেইল ঐচ্ছিক। ঠিকানা দিন ধাপে ধাপে: বিভাগ › জেলা › উপজেলা › ইউনিয়ন (ঐচ্ছিক)।
      </p>

      <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card" aria-label="আপনার কার্ট">
        <h2 className="text-base font-semibold text-text-main">আপনার কার্ট</h2>
        <ul className="mt-3 divide-y divide-border">
          {cart.items.map((item) => (
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
          <select name="shippingMethod" defaultValue="inside_dhaka" className={INPUT_CLASS}>
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
          disabled={stockProblems.length > 0}
          className="brand-gradient h-12 w-full rounded-xl text-base font-semibold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          অর্ডার নিশ্চিত করুন
        </button>
      </form>

      {errors.length > 0 && (
        <ul role="alert" className="mt-4 space-y-1 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}
      {submitted && (
        <p role="status" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          ধন্যবাদ! ফর্মের তথ্য যাচাই সম্পন্ন হয়েছে। (ডেমো অবস্থা: এই পেজ থেকে এখনো আসল অর্ডার তৈরি হয় না — API সংযোগ সম্পন্ন হলে অর্ডারটি ডেটাবেসে সংরক্ষিত হবে।)
        </p>
      )}

      {/* Sticky order-summary bar — small screens only. Sits directly
          above the shell's mobile bottom nav (bottom-16); the desktop
          flow keeps the in-page summary + submit, unchanged. */}
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
