"use client";

/**
 * "সহায়ক" (helpful) button on a PDP review. POSTs to
 * /api/v1/public/reviews/[id]/helpful — one vote per voter (signed-in
 * customer id, or a hashed guest key server-side); a repeat click is
 * a server no-op and the button settles into the pressed state with
 * the authoritative count from the response. Serializable props
 * only: review id + product slug + initial count/state.
 *
 * The PDP renders statically, so the viewer's already-voted state
 * cannot be baked into the page: on mount the button resolves it
 * from /api/v1/public/products/[slug]/reviews/votes (one shared
 * request per product per page load — see loadVotedReviewIds) and
 * settles into the pressed state when its review id comes back.
 */
import { useEffect, useState } from "react";

interface HelpfulResponse {
  data?: { helpfulCount: number; counted: boolean };
  error?: { message?: string };
}

interface VotesResponse {
  data?: { votedReviewIds?: string[] };
}

// One votes lookup per product slug per page load, shared by every
// helpful button rendered for that product (module scope — this
// file is a client component, so the map lives in the browser).
const votedIdsBySlug = new Map<string, Promise<Set<string>>>();

function loadVotedReviewIds(productSlug: string): Promise<Set<string>> {
  let pending = votedIdsBySlug.get(productSlug);
  if (!pending) {
    pending = fetch(
      `/api/v1/public/products/${encodeURIComponent(productSlug)}/reviews/votes`,
    )
      .then(async (res) => {
        if (!res.ok) return new Set<string>();
        const json = (await res.json().catch(() => null)) as VotesResponse | null;
        return new Set(json?.data?.votedReviewIds ?? []);
      })
      .catch(() => new Set<string>());
    votedIdsBySlug.set(productSlug, pending);
  }
  return pending;
}

export function HelpfulButton({
  reviewId,
  productSlug,
  initialCount,
  initialVoted,
}: {
  reviewId: string;
  productSlug: string;
  initialCount: number;
  initialVoted: boolean;
}) {
  const [count, setCount] = useState(initialCount);
  const [voted, setVoted] = useState(initialVoted);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // Merge the viewer's server-resolved voted ids into the pressed
  // state (initialised from the prop, which the static page renders
  // as unpressed).
  useEffect(() => {
    if (voted) return;
    let alive = true;
    loadVotedReviewIds(productSlug)
      .then((ids) => {
        if (alive && ids.has(reviewId)) setVoted(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [productSlug, reviewId, voted]);

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
