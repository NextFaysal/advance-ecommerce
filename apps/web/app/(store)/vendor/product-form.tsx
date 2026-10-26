"use client";

/**
 * Vendor product submission form (ADV-13). Price is entered in টাকা
 * and converted to integer poisha with string math (no floats). The
 * listing lands in the staff approval queue as PENDING_REVIEW; the
 * server re-validates everything — this form is never the
 * enforcement.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

/** "1234.50" -> 123450 poisha; null when malformed. */
function takaToPoisha(raw: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!m) return null;
  const taka = Number(m[1]);
  const paisa = Number(((m[2] ?? "") + "00").slice(0, 2));
  const poisha = taka * 100 + paisa;
  return Number.isSafeInteger(poisha) ? poisha : null;
}

export default function VendorProductForm() {
  const router = useRouter();
  const [productName, setProductName] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    const pricePoisha = takaToPoisha(price);
    if (pricePoisha === null || pricePoisha <= 0) {
      setError("সঠিক দাম লিখুন (টাকায়)।");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/v1/public/vendor/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productName, sku, pricePoisha }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setError(body.error?.message ?? "পণ্য জমা দেওয়া যায়নি — আবার চেষ্টা করুন।");
        return;
      }
      setDone(true);
      setProductName("");
      setSku("");
      setPrice("");
      router.refresh();
    } catch {
      setError("পণ্য জমা দেওয়া যায়নি — সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-text-main";

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3 border-t border-border pt-4">
      <p className="text-sm font-medium text-text-main">নতুন পণ্য জমা দিন</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-sm text-text-muted">পণ্যের নাম</span>
          <input value={productName} onChange={(e) => setProductName(e.target.value)} className={inputClass} required />
        </label>
        <label className="block">
          <span className="text-sm text-text-muted">SKU</span>
          <input value={sku} onChange={(e) => setSku(e.target.value)} className={inputClass} required />
        </label>
        <label className="block">
          <span className="text-sm text-text-muted">দাম (টাকা)</span>
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="যেমন: 1250" className={inputClass} required />
        </label>
      </div>
      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-700">
          ✅ পণ্য জমা হয়েছে — স্টাফ অনুমোদন দিলে তালিকায় APPROVED দেখা যাবে।
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        {busy ? "জমা হচ্ছে…" : "অনুমোদনের জন্য জমা দিন"}
      </button>
    </form>
  );
}
