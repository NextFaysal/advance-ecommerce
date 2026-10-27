"use client";

/**
 * Haat PDP tabs (doc 27 theme T-A) — a small client switcher
 * with two tabs: Description / Customer Reviews.
 *
 * Both panels are server-rendered by the composition and passed
 * in as ReactNodes (the platform's RSC interleaving pattern — no
 * functions cross the boundary). The switcher only toggles which
 * panel is visible; it never unmounts either, so the reviews
 * section's server-rendered content and the description's own
 * state survive tab switches. The active tab is a solid-orange
 * pill — this package's tab treatment.
 */
import { useState } from "react";
import type { ReactNode } from "react";

export default function HaatPdpTabs({
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
        className="flex max-w-full gap-2 overflow-x-auto border-b-2 border-border"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "description"}
          onClick={() => setTab("description")}
          className={`-mb-[2px] h-11 shrink-0 border-b-2 px-4 text-sm font-bold transition duration-200 sm:px-5 ${
            tab === "description"
              ? "border-primary text-primary"
              : "border-transparent text-text-muted hover:text-text-main"
          }`}
        >
          Description
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "reviews"}
          onClick={() => setTab("reviews")}
          className={`-mb-[2px] h-11 shrink-0 border-b-2 px-4 text-sm font-bold transition duration-200 sm:px-5 ${
            tab === "reviews"
              ? "border-primary text-primary"
              : "border-transparent text-text-muted hover:text-text-main"
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
