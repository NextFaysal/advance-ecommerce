"use client";

/**
 * Circuit "{s.categoriesHeading}" row (doc 27 T-D) — client island:
 * a horizontally scrollable row of rounded white tiles under a
 * CENTRED heading (this package's section-heading style), with
 * navy circular arrow buttons.
 *
 * Tiles carry the category's OWN image when the catalog has one;
 * otherwise an initial tile of our own — a tinted rounded square
 * with the category's first letter. No third-party illustration is
 * used or imitated.
 */
import { useRef } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { useDigitText } from "@/components/ui/numerals";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { CIRCUIT_STRINGS } from "./strings";
import type { Category } from "@/catalog/types";
import { CIRCUIT_COLORS } from "./tokens";

/* Cool tile tints for image-less categories (our own palette). */
const TILE_TINTS: ReadonlyArray<string> = [
  "bg-[#FDEBD7] text-[#B25B00]",
  "bg-[#E3EDF7] text-[#1D4E79]",
  "bg-[#E6F4EA] text-[#1E7A46]",
  "bg-[#F3E8FB] text-[#5B21B6]",
  "bg-[#E0F5FA] text-[#0E7490]",
  "bg-[#FDE8E4] text-[#B3372B]",
];

export default function CircuitHomeCategories({
  categories,
}: {
  categories: Category[];
}) {
  const { locale } = useLocale();
  const s = pick(locale, CIRCUIT_STRINGS);
  const digits = useDigitText();
  const trackRef = useRef<HTMLDivElement>(null);

  if (categories.length === 0) return null;

  const scrollBy = (dir: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: dir * Math.round(track.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <section className="mt-12" aria-label={s.categoriesAria}>
      <div className="relative flex items-center justify-center">
        <div className="text-center">
          <h2 className="font-display text-xl font-extrabold text-text-main sm:text-2xl">
            {s.categoriesHeading}
          </h2>
          <span aria-hidden="true" className="mx-auto mt-1.5 block h-[3px] w-10 rounded-full bg-primary" />
        </div>
        <div className="absolute right-0 hidden gap-2 sm:flex">
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label={s.prevCategories}
            className="flex h-10 w-10 items-center justify-center rounded-full text-white shadow-card transition hover:opacity-90"
            style={{ backgroundColor: CIRCUIT_COLORS.navy }}
          >
            <Icon name="chevron-right" size={18} className="rotate-180" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label={s.nextCategories}
            className="flex h-10 w-10 items-center justify-center rounded-full text-white shadow-card transition hover:opacity-90"
            style={{ backgroundColor: CIRCUIT_COLORS.navy }}
          >
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        className="scrollbar-none -mx-4 mt-5 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
      >
        {categories.map((c, i) => (
          <Link
            key={c.slug}
            href={`/shop?category=${c.slug}`}
            className="group w-[112px] shrink-0 snap-start rounded-lg border border-border bg-card p-2.5 shadow-card transition duration-200 hover:shadow-lift"
          >
            <span className="block aspect-square overflow-hidden rounded-md">
              {c.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.imageUrl}
                  alt={c.name[locale] || c.name.bn}
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.05]"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className={`flex h-full w-full items-center justify-center text-3xl font-extrabold ${TILE_TINTS[i % TILE_TINTS.length]}`}
                >
                  {(c.name[locale] || c.name.bn).charAt(0)}
                </span>
              )}
            </span>
            <span className="mt-2 block truncate text-center text-[13px] font-bold leading-snug text-text-main">
              {c.name[locale] || c.name.bn}
            </span>
            <span className="block text-center text-[11px] text-text-subtle">
              {digits(interpolate(s.productCount, { count: c.productCount }))}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
