"use client";

/**
 * Ask-a-question form on the PDP Q&A section. POSTs to
 * /api/v1/public/products/[slug]/questions — signed-in customers
 * only (the server answers 401 otherwise; the section renders a
 * login prompt instead of this form for guests). A question is born
 * PENDING and appears publicly only after staff answer it — the
 * success copy says exactly that.
 */
import { useState } from "react";

interface AskResponse {
  error?: { message?: string };
}

export function AskQuestionForm({ productSlug }: { productSlug: string }) {
  const [question, setQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/v1/public/products/${encodeURIComponent(productSlug)}/questions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: question.trim() }),
        },
      );
      const json = (await res.json().catch(() => null)) as AskResponse | null;
      if (!res.ok) {
        setMessage({
          ok: false,
          text: json?.error?.message ?? "প্রশ্ন পাঠানো যায়নি — আবার চেষ্টা করুন।",
        });
        return;
      }
      setMessage({
        ok: true,
        text: "ধন্যবাদ! আপনার প্রশ্নটি জমা হয়েছে — আমাদের টিম উত্তর দিলেই এখানে প্রকাশিত হবে।",
      });
      setQuestion("");
    } catch {
      setMessage({ ok: false, text: "নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3">
      <label className="block text-sm font-medium text-text-main" htmlFor="qa-question">
        আপনার প্রশ্ন লিখুন
      </label>
      <textarea
        id="qa-question"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        required
        minLength={3}
        maxLength={1000}
        rows={3}
        placeholder="এই পণ্য সম্পর্কে জানতে চান…"
        className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm leading-6 text-text-main shadow-sm outline-none focus:border-brand-500"
      />
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={`text-sm font-medium ${message.ok ? "text-emerald-600" : "text-rose-600"}`}
        >
          {message.text}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={submitting}
        className="brand-gradient h-11 rounded-xl px-5 text-sm font-bold text-white shadow-md transition hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
      >
        {submitting ? "পাঠানো হচ্ছে…" : "প্রশ্ন করুন"}
      </button>
    </form>
  );
}
