"use client";

/**
 * Vendor portal payout request form (schema wave 2) — mirrors the
 * reseller form (ADV-12). Amount is entered in টাকা and converted
 * to integer poisha with string math (no floats). The server
 * re-checks the amount against the computed available balance
 * inside a locked transaction — this form's max is a hint, never
 * the enforcement. A PAID decision later only records that staff
 * paid externally; nothing here moves money.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBdt } from "@/checkout/pricing";

/** "1234.50" -> 123450 poisha; null when malformed. */
function takaToPoisha(raw: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!m) return null;
  const taka = Number(m[1]);
  const paisa = Number(((m[2] ?? "") + "00").slice(0, 2));
  const poisha = taka * 100 + paisa;
  return Number.isSafeInteger(poisha) ? poisha : null;
}

export default function VendorPayoutRequestForm({ availablePoisha }: { availablePoisha: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("BKASH");
  const [accountNote, setAccountNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    const amountPoisha = takaToPoisha(amount);
    if (amountPoisha === null || amountPoisha <= 0) {
      setError("সঠিক পরিমাণ লিখুন (টাকায়)।");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/v1/public/vendor/payouts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountPoisha, method, accountNote }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setError(body.error?.message ?? "অনুরোধ পাঠানো যায়নি — আবার চেষ্টা করুন।");
        return;
      }
      setDone(true);
      setAmount("");
      setAccountNote("");
      router.refresh();
    } catch {
      setError("অনুরোধ পাঠানো যায়নি — সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3">
      <p className="text-sm text-text-muted">
        উত্তোলনযোগ্য ব্যালেন্স: <strong className="text-text-main">{formatBdt(availablePoisha)}</strong>
        <span className="block text-xs">সর্বনিম্ন অনুরোধ ৳৫০০।</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-text-main">পরিমাণ (টাকা)</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="যেমন: 1000"
            className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-text-main"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-text-main">মাধ্যম</span>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-text-main"
          >
            <option value="BKASH">বিকাশ</option>
            <option value="NAGAD">নগদ</option>
            <option value="BANK">ব্যাংক</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-sm font-medium text-text-main">কোন অ্যাকাউন্টে পাঠাতে হবে</span>
        <input
          value={accountNote}
          onChange={(e) => setAccountNote(e.target.value)}
          placeholder="যেমন: বিকাশ পার্সোনাল 01XXXXXXXXX"
          className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-text-main"
          required
        />
      </label>
      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {done ? (
        <p role="status" className="rounded-xl bg-green-50 px-3 py-2 text-sm text-green-700">
          ✅ অনুরোধ পাঠানো হয়েছে — স্টোর যাচাই করে অনুমোদন দিলে এই পেজেই স্ট্যাটাস দেখতে পাবেন।
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || availablePoisha <= 0}
        className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        {busy ? "পাঠানো হচ্ছে…" : "পে-আউট অনুরোধ পাঠান"}
      </button>
      <p className="text-xs leading-6 text-text-muted">
        অনুরোধ পাঠালে কোনো টাকা কাটা বা পাঠানো হয় না — স্টাফ অনুমোদনের পর সিস্টেমের বাইরে
        (বিকাশ/নগদ/ব্যাংক) পেমেন্ট করে এখানে "পরিশোধিত" রেকর্ড করেন।
      </p>
    </form>
  );
}
