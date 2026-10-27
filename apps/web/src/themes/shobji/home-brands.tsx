"use client";

/**
 * Shobji "আমাদের ব্র্যান্ড" row (doc 27 theme T-B) — client
 * island. Shobji declares no brand-toggle option, so unlike the
 * Bazaar island this section is not option-gated: it renders
 * whenever the fetched products carry real brand names.
 *
 * The brands are REAL: the distinct `brandName` values of the
 * products the home page already fetched, passed in as props by
 * the server composition. There is no brand-logo asset in the
 * platform, so each tile is a bordered white box with the brand's
 * own name in text — never a drawn/imitation logo. Every tile
 * links to the shop's real brand filter (/shop?brand=<name>).
 * With no branded products, the section renders nothing.
 */
import Link from "next/link";

export default function ShobjiHomeBrands({ brands }: { brands: string[] }) {
  if (brands.length === 0) return null;

  return (
    <section className="mt-12" aria-label="আমাদের ব্র্যান্ড">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-extrabold text-text-main sm:text-2xl">
            আমাদের ব্র্যান্ড
          </h2>
          <span aria-hidden="true" className="mt-1.5 block h-[3px] w-10 rounded-full bg-primary" />
        </div>
        <Link
          href="/shop"
          className="shrink-0 text-sm font-bold text-primary hover:underline"
        >
          সব দেখুন →
        </Link>
      </div>
      <div className="scrollbar-none -mx-4 mt-5 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {brands.map((name) => (
          <Link
            key={name}
            href={`/shop?brand=${encodeURIComponent(name)}`}
            className="flex h-[72px] w-[160px] shrink-0 items-center justify-center rounded-xl border border-border bg-card px-3 text-center shadow-card transition duration-200 hover:shadow-lift"
          >
            <span className="line-clamp-2 break-words text-[15px] font-extrabold leading-snug text-text-main [overflow-wrap:anywhere]">
              {name}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
