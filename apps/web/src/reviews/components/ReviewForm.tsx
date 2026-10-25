"use client";

/**
 * Public review submission form (PDP). POSTs to
 * /api/v1/public/products/[slug]/reviews. The review is born PENDING
 * and shows publicly only after admin moderation — the success copy
 * says so plainly. Includes the `website` honeypot field (hidden;
 * bots fill it and get a plausible success while nothing is stored —
 * see src/reviews/policy.ts).
 *
 * Serializable props only: the product slug string.
 */
import { useState } from "react";

interface ReviewResponse {
  data?: { review: { status: string } };
  error?: { message?: string };
}

const inputClass =
  "h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm text-text-main shadow-sm outline-none focus:border-brand-500";

export function ReviewForm({ productSlug }: { productSlug: string }) {
  const [authorName, setAuthorName] = useState("");
  const [phone, setPhone] = useState("");
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/public/products/${encodeURIComponent(productSlug)}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorName,
          phone,
          rating,
          ...(title.trim() ? { title: title.trim() } : {}),
          body,
          website,
        }),
      });
      const json = (await res.json().catch(() => null)) as ReviewResponse | null;
      if (!res.ok || !json?.data) {
        setMessage({
          ok: false,
          text: json?.error?.message ?? "রিভিউ পাঠানো যায়নি — তথ্য যাচাই করে আবার চেষ্টা করুন।",
        });
        return;
      }
      setMessage({
        ok: true,
        text: "ধন্যবাদ! আপনার রিভিউটি জমা হয়েছে — মডারেশনের পর প্রকাশিত হবে।",
      });
      setAuthorName("");
      setPhone("");
      setTitle("");
      setBody("");
      setRating(5);
    } catch {
      setMessage({ ok: false, text: "নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3.5">
      <div>
        <span className="mb-1.5 block text-sm font-medium text-text-main" id="review-rating-label">
          আপনার রেটিং
        </span>
        <div className="flex gap-1" role="radiogroup" aria-labelledby="review-rating-label">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} তারকা`}
              onClick={() => setRating(n)}
              className="rounded-lg p-1 transition hover:bg-surface-2"
            >
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill={n <= rating ? "#F59E0B" : "none"}
                stroke="#F59E0B"
                strokeWidth="1.8"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 3.6l2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L12 16.3l-5.1 2.7 1.1-5.6-4.2-3.9 5.7-.7L12 3.6z" />
              </svg>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-main" htmlFor="review-name">
            আপনার নাম
          </label>
          <input
            id="review-name"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            required
            minLength={2}
            maxLength={80}
            placeholder="যেমন: রুমা আক্তার"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-main" htmlFor="review-phone">
            মোবাইল নম্বর
          </label>
          <input
            id="review-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            inputMode="tel"
            autoComplete="tel"
            placeholder="01XXXXXXXXX"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-text-subtle">
            নম্বরটি শুধু যাচাইয়ের জন্য — সবার কাছে কখনো দেখানো হবে না।
          </p>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-main" htmlFor="review-title">
          শিরোনাম (ঐচ্ছিক)
        </label>
        <input
          id="review-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder="এক লাইনে আপনার অভিজ্ঞতা"
          className={inputClass}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-main" htmlFor="review-body">
          আপনার রিভিউ
        </label>
        <textarea
          id="review-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          minLength={3}
          maxLength={2000}
          rows={4}
          placeholder="পণ্যটি ব্যবহার করে কেমন লেগেছে, বিস্তারিত লিখুন…"
          className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm leading-6 text-text-main shadow-sm outline-none focus:border-brand-500"
        />
      </div>

      {/* Honeypot — hidden from humans; bots that fill it are dropped
          silently by the API (src/reviews/policy.ts). */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      <button
        type="submit"
        disabled={submitting}
        className="brand-gradient h-12 rounded-xl px-6 text-sm font-bold text-white shadow-md transition hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
      >
        {submitting ? "পাঠানো হচ্ছে…" : "রিভিউ জমা দিন"}
      </button>

      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={`text-sm font-medium ${message.ok ? "text-emerald-600" : "text-rose-600"}`}
        >
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
