"use client";

/**
 * Back-in-stock signup form — Part B wiring (Agent 21).
 * Signups POST to /api/v1/public/back-in-stock, which persists them in
 * the BackInStockSignup table (src/storefront-ux/back-in-stock-db.ts);
 * the response carries only the MASKED phone, which is all we show.
 * No SMS is sent at signup — the notify job sends one when stock is
 * restored.
 */
import { useState } from "react";

interface SignupResponse {
  data?: { signup: { maskedPhone: string }; duplicate: boolean };
  error?: { message?: string };
}

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
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (variants.length === 0) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/public/back-in-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, variantId: variantId || null, phone }),
      });
      const body = (await res.json().catch(() => null)) as SignupResponse | null;
      if (!res.ok || !body?.data) {
        setMessage({ ok: false, text: body?.error?.message ?? "সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)।" });
        return;
      }
      const { signup, duplicate } = body.data;
      setMessage({
        ok: true,
        text: duplicate
          ? `আপনি আগেই সাইন আপ করেছেন (${signup.maskedPhone}) — স্টক এলেই একবার SMS পাবেন।`
          : `ধন্যবাদ! ${signup.maskedPhone} নম্বরে স্টক এলেই SMS পাঠানো হবে।`,
      });
    } catch {
      setMessage({ ok: false, text: "নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।" });
    } finally {
      setSubmitting(false);
    }
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
        <button type="submit" disabled={submitting} className="min-h-[44px] rounded-lg bg-[#4F46E5] px-4 text-sm font-bold text-white disabled:opacity-60">
          জানিয়ে দিন
        </button>
      </div>
      {message ? (
        <p className={`mt-2 text-sm ${message.ok ? "text-emerald-700" : "text-red-600"}`} role="status">
          {message.text}
        </p>
      ) : null}
      <p className="mt-2 text-xs text-slate-500">সাইনআপ ডাটাবেসে সংরক্ষিত থাকে; স্টক এলেই একবার SMS পাঠানো হবে।</p>
    </form>
  );
}
