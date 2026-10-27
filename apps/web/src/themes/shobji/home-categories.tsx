"use client";

/**
 * Shobji "জনপ্রিয় ক্যাটাগরি" tiles (doc 27 theme T-B) — client
 * island: a horizontally scrollable row of white rounded tiles —
 * the category's OWN image when the catalog has one, otherwise an
 * initial tile of our own (a lavender rounded square with the
 * category's first letter) — with a CENTRED label beneath and the
 * category's real product count. Purple circular arrow buttons
 * scroll the row. No third-party illustration is used or imitated.
 */
import { useRef } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { useDigitText } from "@/components/ui/numerals";
import type { Category } from "@/catalog/types";

/* Soft tile tints for image-less categories (our own palette). */
const TILE_TINTS: ReadonlyArray<string> = [
  "bg-[#EFEAF9] text-[#5B2A86]",
  "bg-[#FDF3D8] text-[#8A6100]",
  "bg-[#E3F2E6] text-[#1E7A46]",
  "bg-[#FDE8E4] text-[#B3372B]",
  "bg-[#E8F0FE] text-[#1E3A8A]",
  "bg-[#F3E8FB] text-[#7438A8]",
];

export default function ShobjiHomeCategories({
  categories,
}: {
  categories: Category[];
}) {
  const digits = useDigitText();
  const trackRef = useRef<HTMLDivElement>(null);

  if (categories.length === 0) return null;

  const scrollBy = (dir: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: dir * Math.round(track.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <section className="mt-10" aria-label="জনপ্রিয় ক্যাটাগরি">
      <div className="relative flex items-center justify-center">
        <h2 className="text-center font-display text-xl font-extrabold text-text-main sm:text-2xl">
          জনপ্রিয় ক্যাটাগরি
        </h2>
        <div className="absolute right-0 hidden gap-2 sm:flex">
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label="আগের ক্যাটাগরি"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white shadow-card transition hover:opacity-90"
          >
            <Icon name="chevron-right" size={18} className="rotate-180" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label="পরের ক্যাটাগরি"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white shadow-card transition hover:opacity-90"
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
            className="group w-[112px] shrink-0 snap-start rounded-xl border border-border bg-card p-3 shadow-card transition duration-200 hover:shadow-lift"
          >
            <span className="block aspect-square overflow-hidden rounded-lg">
              {c.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.imageUrl}
                  alt={c.name.bn}
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.05]"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className={`flex h-full w-full items-center justify-center text-3xl font-extrabold ${TILE_TINTS[i % TILE_TINTS.length]}`}
                >
                  {c.name.bn.charAt(0)}
                </span>
              )}
            </span>
            <span className="mt-2 block truncate text-center text-[13px] font-bold leading-snug text-text-main">
              {c.name.bn}
            </span>
            <span className="block text-center text-[11px] text-text-subtle">
              {digits(`${c.productCount}টি পণ্য`)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
