"use client";

/**
 * Vendor KYC submit button (ADV-13) — POSTs
 * /api/v1/public/vendor/kyc/submit (vendor marks KYC submitted /
 * resubmits after DOCUMENTS_REQUESTED) and refreshes the dashboard.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function KycSubmitButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/public/vendor/kyc/submit", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setError(body.error?.message ?? "জমা দেওয়া যায়নি — আবার চেষ্টা করুন।");
        return;
      }
      router.refresh();
    } catch {
      setError("জমা দেওয়া যায়নি — সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        {busy ? "জমা হচ্ছে…" : "KYC জমা দিন"}
      </button>
      {error ? (
        <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
