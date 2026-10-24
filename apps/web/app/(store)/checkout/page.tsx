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

const PAYMENT_TILE_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid #CBD5E1",
  borderRadius: 10,
  padding: "6px 10px 6px 8px",
  cursor: "pointer",
  fontWeight: 600,
};

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

  return (
    <main style={{ padding: 24, maxWidth: 720, fontFamily: "system-ui" }}>
      <h1>চেকআউট — এক পেজেই অর্ডার</h1>
      <p>ফোন নম্বর আবশ্যক, ইমেইল ঐচ্ছিক। ঠিকানা দিন ধাপে ধাপে: বিভাগ › জেলা › উপজেলা › ইউনিয়ন (ঐচ্ছিক)।</p>

      <h2>আপনার কার্ট</h2>
      <ul>
        {cart.items.map((item) => (
          <li key={item.variantId}>
            {item.name} ({item.sku}) x{item.quantity} — {formatBdt(item.unitPricePoisha * item.quantity)}
          </li>
        ))}
      </ul>
      <p>সাবটোটাল: {formatBdt(pricing.subtotalPoisha)} | ডেলিভারি চার্জ: {formatBdt(pricing.shippingPoisha)} | সর্বমোট: {formatBdt(pricing.grandTotalPoisha)}</p>
      {stockProblems.length > 0 && (
        <p role="alert">স্টক সমস্যা: {stockProblems.map((p) => `${p.name} (চেয়েছেন ${p.requested}টি, স্টকে আছে ${p.available}টি)`).join(", ")}</p>
      )}

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <label>আপনার নাম * <input name="customerName" required /></label>
        <label>মোবাইল নম্বর * <input name="phone" placeholder="01XXXXXXXXX" required /></label>
        <label>ইমেইল (ঐচ্ছিক) <input name="email" type="email" /></label>
        <label>বিভাগ * <input name="division" required /></label>
        <label>জেলা * <input name="district" required /></label>
        <label>উপজেলা * <input name="upazila" required /></label>
        <label>ইউনিয়ন (ঐচ্ছিক) <input name="union" /></label>
        <label>বিস্তারিত ঠিকানা * <input name="addressLine" required /></label>
        <label>নোট (ঐচ্ছিক) <input name="note" /></label>
        <label>ডেলিভারি এলাকা
          <select name="shippingMethod" defaultValue="inside_dhaka">
            <option value="inside_dhaka">ঢাকার ভিতরে</option>
            <option value="outside_dhaka">ঢাকার বাইরে</option>
            <option value="pickup">পিকআপ (নিজে এসে নেবেন)</option>
          </select>
        </label>
        <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
          <legend style={{ marginBottom: 8 }}>পেমেন্ট মাধ্যম</legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <label style={PAYMENT_TILE_STYLE}>
              <input type="radio" name="paymentMethod" value="cod" defaultChecked />
              <CodMark />
            </label>
            <label style={PAYMENT_TILE_STYLE}>
              <input type="radio" name="paymentMethod" value="bkash" />
              <BkashMark />
            </label>
            <label style={PAYMENT_TILE_STYLE}>
              <input type="radio" name="paymentMethod" value="nagad" />
              <NagadMark />
            </label>
            <label style={PAYMENT_TILE_STYLE}>
              <input type="radio" name="paymentMethod" value="sslcommerz" />
              <SslCommerzMark />
            </label>
            <label style={PAYMENT_TILE_STYLE}>
              <input type="radio" name="paymentMethod" value="aamarpay" />
              AamarPay
            </label>
            <label style={PAYMENT_TILE_STYLE}>
              <input type="radio" name="paymentMethod" value="shurjopay" />
              ShurjoPay
            </label>
          </div>
          <p style={{ marginTop: 8, color: "#475569", fontSize: 14 }}>
            নিরাপদ পেমেন্ট: পণ্য হাতে পেয়ে টাকা দিন (ক্যাশ অন ডেলিভারি), অথবা বিকাশ, নগদ ও কার্ডে অনলাইনে পরিশোধ করুন।
          </p>
        </fieldset>
        <label>কুপন কোড (ঐচ্ছিক) <input name="couponCode" /></label>
        <button type="submit" disabled={stockProblems.length > 0}>অর্ডার নিশ্চিত করুন</button>
      </form>

      {errors.length > 0 && (
        <ul role="alert">{errors.map((err) => <li key={err}>{err}</li>)}</ul>
      )}
      {submitted && (
        <p role="status">ধন্যবাদ! ফর্মের তথ্য যাচাই সম্পন্ন হয়েছে। (ডেমো অবস্থা: এই পেজ থেকে এখনো আসল অর্ডার তৈরি হয় না — API সংযোগ সম্পন্ন হলে অর্ডারটি ডেটাবেসে সংরক্ষিত হবে।)</p>
      )}
    </main>
  );
}
