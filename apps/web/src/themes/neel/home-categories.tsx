"use client";

/**
 * Neel circular category row (doc 27 T-E) — this package's
 * signature home element, gated by the `showCategoryCircles`
 * merchant option (read from the ThemeView context).
 *
 * A horizontally scrollable row of CIRCLES: each category's own
 * image clipped into a circle, or — when the catalogue has no
 * image — an initial tile of our own (a pale-blue circle with
 * the category's first letter). The category name sits under
 * each circle with its real product count. Every circle links
 * to the category's real shop filter (/shop?category=<slug>).
 * No third-party illustration is used or imitated.
 */
import { useRef } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { useDigitText } from "@/components/ui/numerals";
import type { Category } from "@/catalog/types";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { NEEL_STRINGS } from "./strings";
import { useThemeView } from "../theme-view";

/* Pale tints for image-less category circles (our own palette). */
const CIRCLE_TINTS: ReadonlyArray<string> = [
  "bg-[#EAF2FA] text-[#1773B8]",
  "bg-[#FDF1E3] text-[#9A6A00]",
  "bg-[#E3F2E6] text-[#1E7A46]",
  "bg-[#FDE8E4] text-[#B3372B]",
  "bg-[#EFEAF9] text-[#5B3A8A]",
  "bg-[#FFF3D6] text-[#8A6100]",
];

export default function NeelHomeCategories({
  categories,
}: {
  categories: Category[];
}) {
  const { locale } = useLocale();
  const s = pick(locale, NEEL_STRINGS);
  const themeView = useThemeView();
  const digits = useDigitText();
  const trackRef = useRef<HTMLDivElement>(null);

  if (themeView.options.showCategoryCircles === false) return null;
  if (categories.length === 0) return null;

  const scrollBy = (dir: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: dir * Math.round(track.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <section className="mt-10" aria-label={s.categoriesAria}>
      <div className="relative flex items-center justify-center">
        <h2 className="text-center font-display text-xl font-extrabold text-text-main sm:text-2xl">
          {s.shopByCategory}
        </h2>
        <div className="absolute right-0 hidden gap-2 sm:flex">
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label={s.prevCategories}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white shadow-card transition hover:opacity-90"
          >
            <Icon name="chevron-right" size={18} className="rotate-180" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label={s.nextCategories}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white shadow-card transition hover:opacity-90"
          >
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        className="scrollbar-none -mx-4 mt-6 flex snap-x gap-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
      >
        {categories.map((c, i) => (
          <Link
            key={c.slug}
            href={`/shop?category=${c.slug}`}
            className="group w-[92px] shrink-0 snap-start text-center"
          >
            <span
              className={`mx-auto block h-[76px] w-[76px] overflow-hidden rounded-full border-2 border-transparent shadow-card transition duration-200 group-hover:border-primary group-hover:shadow-lift ${c.imageUrl ? "" : CIRCLE_TINTS[i % CIRCLE_TINTS.length]}`}
            >
              {c.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.imageUrl}
                  alt={c.name[locale] || c.name.bn}
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.06]"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-full w-full items-center justify-center text-[28px] font-extrabold"
                >
                  {(c.name[locale] || c.name.bn).charAt(0)}
                </span>
              )}
            </span>
            <span className="mt-2 block truncate text-[13px] font-bold leading-snug text-text-main">
              {c.name[locale] || c.name.bn}
            </span>
            <span className="block text-[11px] text-text-subtle">
              {digits(interpolate(s.itemsCount, { count: c.productCount }))}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
