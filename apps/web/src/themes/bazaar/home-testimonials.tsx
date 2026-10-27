"use client";

/**
 * Bazaar testimonials (doc 24 wave T3 / doc 25 wave S4b) — client
 * island, gated by the package's `homeShowTestimonials` merchant
 * option (read from the ThemeView context).
 *
 * The reviews are the platform's REAL approved homepage reviews,
 * passed in as props by the server composition — the same rows
 * Aurora prints. Each card shows our own avatar treatment (an
 * initial circle — the platform stores no customer photos), the
 * reviewer's name, the REAL star rating (the shared Stars
 * component), the review text, and the product it belongs to. With
 * no approved reviews, or the option off, nothing renders — no
 * placeholder quotes are ever invented.
 */
import Link from "next/link";
import { Stars } from "@/reviews/components/Stars";
import type { HomepageReview } from "@/reviews/store";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { useThemeView } from "../theme-view";
import { BAZAAR_STRINGS } from "./strings";

export default function BazaarHomeTestimonials({
  reviews,
}: {
  reviews: HomepageReview[];
}) {
  const themeView = useThemeView();
  const { locale } = useLocale();
  const s = pick(locale, BAZAAR_STRINGS);
  if (themeView.options.homeShowTestimonials === false) return null;
  if (reviews.length === 0) return null;

  return (
    <section className="mt-12" aria-label={s.testimonialsAria}>
      <h2 className="text-center font-display text-xl font-extrabold text-text-main sm:text-2xl">
        {s.testimonialsHeading}
      </h2>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {reviews.slice(0, 3).map((r) => (
          <figure
            key={r.id}
            className="rounded-lg border border-border bg-card p-5 shadow-card"
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-base font-extrabold text-secondary-foreground"
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
              {s.productLabel}{" "}
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
