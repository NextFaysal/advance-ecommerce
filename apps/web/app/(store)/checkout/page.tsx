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
      <h1>Checkout — এক পেজে অর্ডার</h1>
      <p>Phone required, email optional. Address: Division &gt; District &gt; Upazila &gt; Union (optional).</p>

      <h2>Cart</h2>
      <ul>
        {cart.items.map((item) => (
          <li key={item.variantId}>
            {item.name} ({item.sku}) x{item.quantity} — {formatBdt(item.unitPricePoisha * item.quantity)}
          </li>
        ))}
      </ul>
      <p>Subtotal: {formatBdt(pricing.subtotalPoisha)} | Shipping: {formatBdt(pricing.shippingPoisha)} | Total: {formatBdt(pricing.grandTotalPoisha)}</p>
      {stockProblems.length > 0 && (
        <p role="alert">Stock problem: {stockProblems.map((p) => `${p.name} (asked ${p.requested}, available ${p.available})`).join(", ")}</p>
      )}

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <label>Nam * <input name="customerName" required /></label>
        <label>Mobile * <input name="phone" placeholder="01XXXXXXXXX" required /></label>
        <label>Email (optional) <input name="email" type="email" /></label>
        <label>Division * <input name="division" required /></label>
        <label>District * <input name="district" required /></label>
        <label>Upazila * <input name="upazila" required /></label>
        <label>Union (optional) <input name="union" /></label>
        <label>Thikana * <input name="addressLine" required /></label>
        <label>Note <input name="note" /></label>
        <label>Shipping
          <select name="shippingMethod" defaultValue="inside_dhaka">
            <option value="inside_dhaka">Inside Dhaka</option>
            <option value="outside_dhaka">Outside Dhaka</option>
            <option value="pickup">Pickup</option>
          </select>
        </label>
        <label>Payment
          <select name="paymentMethod" defaultValue="cod">
            <option value="cod">Cash on Delivery</option>
            <option value="bkash">bKash</option>
            <option value="nagad">Nagad</option>
            <option value="sslcommerz">SSLCommerz</option>
            <option value="aamarpay">AamarPay</option>
            <option value="shurjopay">ShurjoPay</option>
          </select>
        </label>
        <label>Coupon <input name="couponCode" /></label>
        <p>Idempotency key (one per attempt): <code>{idempotencyKey}</code></p>
        <button type="submit" disabled={stockProblems.length > 0}>Order Confirm korun</button>
      </form>

      {errors.length > 0 && (
        <ul role="alert">{errors.map((err) => <li key={err}>{err}</li>)}</ul>
      )}
      {submitted && (
        <p role="status">Form validation pass hoyeche. TEMPORARY MOCK: ashol order toiri hobe jokhon API route wire hobe — ekhon kono order DB te jay ni.</p>
      )}
    </main>
  );
}
