"use client";

/**
 * Birth-date field for the account profile (schema wave 2) — feeds
 * the birthday-offer job (src/marketing/birthday.ts). The current
 * value loads from GET /api/v1/public/account/me; saving PATCHes the
 * same route. Optional by design: unset = no birthday coupon, which
 * the copy says plainly.
 */
import { useEffect, useState } from "react";

export default function BirthDateField() {
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/public/account/me");
        const body = (await res.json().catch(() => ({}))) as {
          data?: { birthDate?: string | null };
        };
        if (!cancelled) {
          setValue(body.data?.birthDate ?? "");
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(next: string | null) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/public/account/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ birthDate: next }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        data?: { birthDate?: string | null };
      };
      if (!res.ok) {
        setError(body.error?.message ?? "সংরক্ষণ করা যায়নি।");
        return;
      }
      setValue(body.data?.birthDate ?? "");
      setMessage(next === null ? "জন্মতারিখ মুছে ফেলা হয়েছে।" : "জন্মতারিখ সংরক্ষিত হয়েছে।");
    } catch {
      setError("সংরক্ষণ করা যায়নি — সংযোগ পরীক্ষা করুন।");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <dt className="text-text-muted">জন্মতারিখ (ঐচ্ছিক)</dt>
      <dd className="mt-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={value}
            disabled={!loaded || busy}
            onChange={(e) => setValue(e.target.value)}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-text-main"
            aria-label="জন্মতারিখ"
          />
          <button
            type="button"
            disabled={!loaded || busy || value === ""}
            onClick={() => void save(value === "" ? null : value)}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            সংরক্ষণ
          </button>
          {value !== "" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(null)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-text-muted disabled:opacity-50"
            >
              মুছুন
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-xs leading-5 text-text-subtle">
          জন্মদিনের অফার পেতে জন্মতারিখ দিন — জন্মদিনের আগে একটি ডিসকাউন্ট কুপন পাবেন।
        </p>
        {message ? <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">{message}</p> : null}
        {error ? <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</p> : null}
      </dd>
    </div>
  );
}
