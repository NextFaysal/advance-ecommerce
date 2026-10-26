"use client";

/**
 * Reply form on the customer's ticket thread. POSTs to
 * /api/v1/public/account/tickets/[id]/reply — the reply moves the
 * ticket back to OPEN (reopening it if staff had closed it). On
 * success the server-rendered thread is refreshed in place.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

interface ReplyResponse {
  error?: { message?: string };
}

export function TicketReplyForm({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/public/account/tickets/${ticketId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim() }),
      });
      const json = (await res.json().catch(() => null)) as ReplyResponse | null;
      if (!res.ok) {
        setError(json?.error?.message ?? "উত্তর পাঠানো যায়নি — আবার চেষ্টা করুন।");
        return;
      }
      setBody("");
      router.refresh();
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block text-sm font-medium text-text-main" htmlFor="ticket-reply-body">
        উত্তর লিখুন
      </label>
      <textarea
        id="ticket-reply-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        minLength={1}
        maxLength={5000}
        rows={3}
        placeholder="আপনার বার্তা লিখুন…"
        className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm leading-6 text-text-main shadow-sm outline-none focus:border-brand-500"
      />
      {error ? (
        <p role="alert" className="text-sm font-medium text-rose-600">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={submitting}
        className="brand-gradient h-11 rounded-xl px-5 text-sm font-bold text-white shadow-md transition hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
      >
        {submitting ? "পাঠানো হচ্ছে…" : "উত্তর পাঠান"}
      </button>
    </form>
  );
}
