"use client";

/**
 * Circuit PDP tabs (doc 27 T-D) — a small client switcher with
 * two tabs: Description / Customer Reviews.
 *
 * Both panels are server-rendered by the composition and passed in
 * as ReactNodes (the platform's RSC interleaving pattern — no
 * functions cross the boundary). The switcher only toggles which
 * panel is visible; it never unmounts either, so the reviews
 * section's server-rendered content and the description's own
 * state survive tab switches.
 */
import { useState } from "react";
import type { ReactNode } from "react";

export default function CircuitPdpTabs({
  description,
  reviews,
}: {
  description: ReactNode;
  reviews: ReactNode;
}) {
  const [tab, setTab] = useState<"description" | "reviews">("description");

  return (
    <div className="mt-8">
      <div
        role="tablist"
        aria-label="পণ্যের তথ্য"
        className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "description"}
          onClick={() => setTab("description")}
          className={`h-10 shrink-0 rounded-lg px-4 text-sm font-bold transition duration-200 sm:px-5 ${
            tab === "description"
              ? "bg-card text-primary shadow-card"
              : "text-text-muted hover:text-text-main"
          }`}
        >
          Description
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "reviews"}
          onClick={() => setTab("reviews")}
          className={`h-10 shrink-0 rounded-lg px-4 text-sm font-bold transition duration-200 sm:px-5 ${
            tab === "reviews"
              ? "bg-card text-primary shadow-card"
              : "text-text-muted hover:text-text-main"
          }`}
        >
          Customer Reviews
        </button>
      </div>

      <div className={tab === "description" ? "" : "hidden"}>
        <div role="tabpanel">{description}</div>
      </div>
      <div className={tab === "reviews" ? "" : "hidden"}>
        <div role="tabpanel">{reviews}</div>
      </div>
    </div>
  );
}
