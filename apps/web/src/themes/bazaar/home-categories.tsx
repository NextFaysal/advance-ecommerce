"use client";

/**
 * Bazaar "Featured Categories" (doc 24 wave T3 / doc 25 wave S4b) —
 * client island: a horizontally scrollable row of rounded-square
 * white tiles with orange circular arrow buttons, under a centred
 * heading (the reference layout's category carousel anatomy).
 *
 * Tiles carry the category's OWN image when the catalog has one;
 * otherwise a warm initial tile of our own — a coloured rounded
 * square with the category's first letter. No third-party
 * illustration is used or imitated.
 */
import { useRef } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { useDigitText } from "@/components/ui/numerals";
import type { Category } from "@/catalog/types";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { BAZAAR_STRINGS } from "./strings";
import { StoreImage } from "@/storefront-ux/components/StoreImage";
import { RAIL_FADE_CLASS } from "@/storefront-ux/responsive";

/* Warm tile tints for image-less categories (our own palette). */
const TILE_TINTS: ReadonlyArray<string> = [
  "bg-[#FDEBD7] text-[#B25B00]",
  "bg-[#E3F2E6] text-[#1E7A46]",
  "bg-[#FDF1E3] text-[#9A6A00]",
  "bg-[#FDE8E4] text-[#B3372B]",
  "bg-[#E8F0FE] text-[#1E3A8A]",
  "bg-[#FFF3D6] text-[#8A6100]",
];

export default function BazaarHomeCategories({
  categories,
}: {
  categories: Category[];
}) {
  const digits = useDigitText();
  const { locale } = useLocale();
  const s = pick(locale, BAZAAR_STRINGS);
  const trackRef = useRef<HTMLDivElement>(null);

  if (categories.length === 0) return null;

  const scrollBy = (dir: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: dir * Math.round(track.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <section className="mt-10" aria-label={s.featuredCategoriesAria}>
      <div className="relative flex items-center justify-center">
        <h2 className="text-center font-display text-xl font-extrabold text-text-main sm:text-2xl">
          {s.featuredCategories}
        </h2>
        <div className="absolute right-0 hidden gap-2 sm:flex">
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label={s.prevCategoriesAria}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white shadow-card transition hover:opacity-90"
          >
            <Icon name="chevron-right" size={18} className="rotate-180" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label={s.nextCategoriesAria}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white shadow-card transition hover:opacity-90"
          >
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        className={`scrollbar-none -mx-4 mt-5 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 ${RAIL_FADE_CLASS}`}
      >
        {categories.map((c, i) => (
          <Link
            key={c.slug}
            href={`/shop?category=${c.slug}`}
            className="group w-[104px] shrink-0 snap-start rounded-lg border border-border bg-card p-2.5 shadow-card transition duration-200 hover:shadow-lift"
          >
            {c.imageUrl ? (
              <StoreImage
                src={c.imageUrl}
                alt={c.name[locale] || c.name.bn}
                preset="thumb"
                className="rounded-md"
                imgClassName="transition duration-300 group-hover:scale-[1.05]"
              />
            ) : (
              <span
                aria-hidden="true"
                className={`flex aspect-square items-center justify-center rounded-md text-3xl font-extrabold ${TILE_TINTS[i % TILE_TINTS.length]}`}
              >
                {(c.name[locale] || c.name.bn).charAt(0)}
              </span>
            )}
            <span className="mt-2 block truncate text-center text-[13px] font-bold leading-snug text-text-main">
              {c.name[locale] || c.name.bn}
            </span>
            <span className="block text-center text-[11px] text-text-subtle">
              {digits(interpolate(s.productCountLine, { count: c.productCount }))}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
