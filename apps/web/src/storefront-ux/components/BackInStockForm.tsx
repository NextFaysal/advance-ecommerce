"use client";

/**
 * Back-in-stock signup form — Part B wiring (Agent 21).
 * TEMPORARY DEMO: signups go to the in-memory demoBackInStockStore
 * (src/storefront-ux/back-in-stock.ts) via client state only — they do
 * not persist and no SMS is sent. The store validates + normalizes the
 * BD phone and returns only the masked number, which is all we show.
 */
import { useState } from "react";
import { demoBackInStockStore } from "../back-in-stock";

export function BackInStockForm({
  productId,
  variants,
}: {
  productId: string;
  /** Out-of-stock variants only — the parent renders nothing when empty. */
  variants: Array<{ variantId: string; label: string }>;
}) {
  const [variantId, setVariantId] = useState<string>(variants[0]?.variantId ?? "");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (variants.length === 0) return null;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = demoBackInStockStore.add({ productId, variantId: variantId || null, phone });
    if (!result.ok) {
      setMessage({ ok: false, text: result.error });
      return;
    }
    setMessage({
      ok: true,
      text: result.duplicate
        ? `আপনি আগেই সাইন আপ করেছেন (${result.signup.maskedPhone}) — স্টক এলেই একবার SMS পাবেন।`
        : `ধন্যবাদ! ${result.signup.maskedPhone} নম্বরে স্টক এলেই SMS পাঠানো হবে।`,
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h2 className="font-semibold">স্টক শেষ — এলে জানিয়ে দেব</h2>
      <p className="mt-1 text-sm text-slate-600">আপনার মোবাইল নম্বর দিন, পণ্যটি আবার স্টকে এলেই SMS পাবেন।</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <select
          value={variantId}
          onChange={(e) => setVariantId(e.target.value)}
          className="min-h-[44px] rounded-lg border bg-white px-3 text-sm"
          aria-label="ভেরিয়েন্ট বাছুন"
        >
          {variants.map((v) => (
            <option key={v.variantId} value={v.variantId}>
              {v.label}
            </option>
          ))}
        </select>
        <input
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="01XXXXXXXXX"
          className="min-h-[44px] flex-1 rounded-lg border bg-white px-3 text-sm"
          aria-label="মোবাইল নম্বর"
        />
        <button type="submit" className="min-h-[44px] rounded-lg bg-[#4F46E5] px-4 text-sm font-bold text-white">
          জানিয়ে দিন
        </button>
      </div>
      {message ? (
        <p className={`mt-2 text-sm ${message.ok ? "text-emerald-700" : "text-red-600"}`} role="status">
          {message.text}
        </p>
      ) : null}
      <p className="mt-2 text-xs text-slate-500">TEMPORARY DEMO — সাইনআপ সংরক্ষিত থাকছে না, কোনো SMS পাঠানো হচ্ছে না।</p>
    </form>
  );
}
