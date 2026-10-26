"use client";

/**
 * Vendor portal login form (ADV-13) — two steps:
 *  1. phone -> POST /api/v1/public/vendor/login/request-otp
 *     (the code is queued for SMS delivery by the worker);
 *  2. code  -> POST /api/v1/public/vendor/login/verify
 *     (the API sets the httpOnly session cookie).
 * This component never sees a token. Delivery copy is kept honest:
 * the code is QUEUED for the SMS worker — this form never claims an
 * SMS has already reached the phone.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function VendorLoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestOtp(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/public/vendor/login/request-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        meta?: { delivery?: string };
      };
      if (!res.ok) {
        setError(body.error?.message ?? "কোড চাওয়া যায়নি — আবার চেষ্টা করুন।");
        return;
      }
      setStep("code");
      setNotice(
        body.meta?.delivery === "queued"
          ? "কোডটি SMS পাঠানোর জন্য কিউতে দেওয়া হয়েছে — SMS পৌঁছালে ১০ মিনিটের মধ্যে কোডটি দিয়ে লগইন করুন।"
          : "কোড তৈরি হয়েছে, তবে SMS কিউতে দেওয়া যায়নি — কিছুক্ষণ পরে আবার চেষ্টা করুন।",
      );
    } catch {
      setError("কোড চাওয়া যায়নি — সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/public/vendor/login/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setError(body.error?.message ?? "লগইন করা যায়নি — আবার চেষ্টা করুন।");
        return;
      }
      router.push("/vendor");
      router.refresh();
    } catch {
      setError("লগইন করা যায়নি — সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-text-main";

  if (step === "phone") {
    return (
      <form onSubmit={requestOtp} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-text-main">মোবাইল নম্বর</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            placeholder="01XXXXXXXXX"
            className={inputClass}
            required
          />
        </label>
        {error ? (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
        >
          {busy ? "কোড পাঠানো হচ্ছে…" : "SMS কোড পাঠান"}
        </button>
        <p className="text-xs leading-6 text-text-muted">
          নম্বরটি আপনার ভেন্ডর অ্যাকাউন্টে দেওয়া নম্বর হতে হবে। কোডটি একবারই ব্যবহার করা যায় এবং
          ১০ মিনিট পর্যন্ত বৈধ থাকে।
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="mt-6 space-y-4">
      {notice ? (
        <p role="status" className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-700">
          {notice}
        </p>
      ) : null}
      <label className="block">
        <span className="text-sm font-medium text-text-main">৬ সংখ্যার কোড</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="••••••"
          className={inputClass}
          required
        />
      </label>
      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        {busy ? "যাচাই হচ্ছে…" : "লগইন করুন"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => requestOtp()}
        className="w-full rounded-xl border border-border px-4 py-2 text-sm font-medium text-text-main transition hover:bg-brand-50 disabled:opacity-60"
      >
        আবার কোড পাঠান
      </button>
    </form>
  );
}
