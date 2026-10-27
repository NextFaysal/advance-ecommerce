/**
 * Haat category tiles (doc 27 theme T-A) — server-rendered grid.
 *
 * A dense tile grid (4 across on phones, up to 8 on desktop):
 * each tile is the category's OWN image when the catalog has
 * one, otherwise a tinted initial tile of our own — a coloured
 * square with the category's first letter. No third-party
 * illustration is used or imitated. Every tile links to the
 * shop's real category filter and shows the category's real
 * product count.
 */
import Link from "next/link";
import { DigitText } from "@/components/ui/numerals";
import type { Category } from "@/catalog/types";

/* Tile tints for image-less categories (our own palette). */
const TILE_TINTS: ReadonlyArray<string> = [
  "bg-[#FDEBD7] text-[#B25B00]",
  "bg-[#E3F2E6] text-[#1E7A46]",
  "bg-[#FDF1E3] text-[#9A6A00]",
  "bg-[#FDE8E4] text-[#B3372B]",
  "bg-[#E8F0FE] text-[#1E3A8A]",
  "bg-[#FFF3D6] text-[#8A6100]",
  "bg-[#EFE9FD] text-[#5B3A9E]",
  "bg-[#E2F4F1] text-[#0F6B5C]",
];

export default function HaatHomeCategories({
  categories,
}: {
  categories: Category[];
}) {
  if (categories.length === 0) return null;

  return (
    <section className="mt-10" aria-label="ক্যাটাগরি">
      <div className="flex items-end justify-between gap-3">
        <h2 className="border-l-4 border-primary pl-3 font-display text-xl font-extrabold text-text-main sm:text-2xl">
          ক্যাটাগরি ধরে কিনুন
        </h2>
        <Link
          href="/shop"
          className="shrink-0 text-sm font-bold text-primary hover:underline"
        >
          সব ক্যাটাগরি →
        </Link>
      </div>

      <div className="mt-5 grid grid-cols-4 gap-2.5 sm:grid-cols-6 lg:grid-cols-8">
        {categories.map((c, i) => (
          <Link
            key={c.slug}
            href={`/shop?category=${c.slug}`}
            className="group rounded border border-border bg-card p-2 shadow-card transition duration-200 hover:shadow-lift"
          >
            <span className="block aspect-square overflow-hidden rounded-sm">
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
              <DigitText text={`${c.productCount}টি পণ্য`} />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
