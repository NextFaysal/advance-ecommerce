"use client";

/**
 * Reseller portal login form (ADV-12) — posts phone + reseller code to
 * /api/v1/public/reseller/login; the API sets the httpOnly session
 * cookie. This component never sees a token.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ResellerLoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/public/reseller/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!res.ok) {
        setError(body.error?.message ?? "লগইন করা যায়নি — আবার চেষ্টা করুন।");
        return;
      }
      router.push("/reseller");
      router.refresh();
    } catch {
      setError("লগইন করা যায়নি — সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-text-main">মোবাইল নম্বর</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          autoComplete="tel"
          placeholder="01XXXXXXXXX"
          className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-text-main"
          required
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-text-main">রিসেলার কোড</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          placeholder="যেমন: AB3K9XYZ"
          className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm uppercase text-text-main"
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
        {busy ? "লগইন হচ্ছে…" : "লগইন করুন"}
      </button>
      <p className="text-xs leading-6 text-text-muted">
        আপনার কোডটি আপনার রেফারেল লিংকের কোডই — এটি গোপন রাখুন, এটিই এই পোর্টালের পাসওয়ার্ডের মতো কাজ করে।
      </p>
    </form>
  );
}
