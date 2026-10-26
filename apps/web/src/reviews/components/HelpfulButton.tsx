"use client";

/**
 * "সহায়ক" (helpful) button on a PDP review. POSTs to
 * /api/v1/public/reviews/[id]/helpful — one vote per voter (signed-in
 * customer id, or a hashed guest key server-side); a repeat click is
 * a server no-op and the button settles into the pressed state with
 * the authoritative count from the response. Serializable props
 * only: review id + initial count/state from the server section.
 */
import { useState } from "react";

interface HelpfulResponse {
  data?: { helpfulCount: number; counted: boolean };
  error?: { message?: string };
}

export function HelpfulButton({
  reviewId,
  initialCount,
  initialVoted,
}: {
  reviewId: string;
  initialCount: number;
  initialVoted: boolean;
}) {
  const [count, setCount] = useState(initialCount);
  const [voted, setVoted] = useState(initialVoted);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onVote() {
    if (busy || voted) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/v1/public/reviews/${reviewId}/helpful`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = (await res.json().catch(() => null)) as HelpfulResponse | null;
      if (!res.ok || !json?.data) {
        setFailed(true);
        return;
      }
      setCount(json.data.helpfulCount);
      setVoted(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void onVote()}
        disabled={busy || voted}
        aria-pressed={voted}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
          voted
            ? "bg-brand-600 text-white"
            : "border border-border bg-surface text-text-muted hover:text-text-main"
        } disabled:cursor-default`}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill={voted ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7 10v12H4a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h3zm0 0 4.2-7.6a2 2 0 0 1 3.7 1.3L14 9h5.4a2 2 0 0 1 2 2.4l-1.2 7.2a2 2 0 0 1-2 1.6H7" />
        </svg>
        সহায়ক ({count})
      </button>
      {failed ? <span className="text-xs text-rose-600">আবার চেষ্টা করুন</span> : null}
    </span>
  );
}
