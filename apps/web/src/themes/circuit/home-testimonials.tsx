"use client";

/**
 * Circuit testimonials (doc 27 T-D) — client island.
 *
 * The reviews are the platform's REAL approved homepage reviews,
 * passed in as props by the server composition — the same rows
 * every package prints. Each card shows our own avatar treatment
 * (a navy initial circle — the platform stores no customer
 * photos), the reviewer's name, the REAL star rating (the shared
 * Stars component), the review text, and the product it belongs
 * to. With no approved reviews, nothing renders — no placeholder
 * quotes are ever invented. (Ratings appear here because they are
 * real review data in props; this package's product CARDS carry
 * no ratings by design.)
 */
import Link from "next/link";
import { Stars } from "@/reviews/components/Stars";
import type { HomepageReview } from "@/reviews/store";
import { CIRCUIT_COLORS } from "./tokens";

export default function CircuitHomeTestimonials({
  reviews,
}: {
  reviews: HomepageReview[];
}) {
  if (reviews.length === 0) return null;

  return (
    <section className="mt-12" aria-label="কাস্টমারদের মতামত">
      <div className="text-center">
        <h2 className="font-display text-xl font-extrabold text-text-main sm:text-2xl">
          কাস্টমাররা যা বলছেন
        </h2>
        <span aria-hidden="true" className="mx-auto mt-1.5 block h-[3px] w-10 rounded-full bg-primary" />
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {reviews.slice(0, 3).map((r) => (
          <figure
            key={r.id}
            className="rounded-lg border border-border bg-card p-5 shadow-card"
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-extrabold text-white"
                style={{ backgroundColor: CIRCUIT_COLORS.navy }}
              >
                {r.authorName.charAt(0)}
              </span>
              <figcaption className="min-w-0">
                <span className="block truncate text-sm font-bold text-text-main">
                  {r.authorName}
                </span>
                <span className="mt-0.5 block">
                  <Stars rating={r.rating} size={13} />
                </span>
              </figcaption>
            </div>
            <blockquote className="mt-3 break-words text-sm leading-7 text-text-main [overflow-wrap:anywhere]">
              “{r.body}”
            </blockquote>
            <p className="mt-3 text-xs text-text-subtle">
              পণ্য:{" "}
              <Link
                href={`/product/${r.productSlug}`}
                className="font-semibold text-primary hover:underline"
              >
                {r.productTitleBn}
              </Link>
            </p>
          </figure>
        ))}
      </div>
    </section>
  );
}
