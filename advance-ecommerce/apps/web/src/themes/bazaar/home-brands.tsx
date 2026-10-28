"use client";

/**
 * Bazaar "Our Brands" row (doc 24 wave T3 / doc 25 wave S4b) —
 * client island, gated by the package's `homeShowBrands` merchant
 * option (read from the ThemeView context — the section is client
 * precisely so the server composition stays option-free).
 *
 * The brands are REAL: the distinct `brandName` values of the
 * products the home page already fetched, passed in as props by the
 * server composition. There is no brand-logo asset in the platform,
 * so each tile is a bordered white box with the brand's own name in
 * text — never a drawn/imitation logo. Every tile links to the
 * shop's real brand filter (/shop?brand=<name>). With no branded
 * products, or the option off, the section renders nothing.
 */
import Link from "next/link";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { useThemeView } from "../theme-view";
import { BAZAAR_STRINGS } from "./strings";
import { RAIL_FADE_CLASS } from "@/storefront-ux/responsive";

export default function BazaarHomeBrands({ brands }: { brands: string[] }) {
  const themeView = useThemeView();
  const { locale } = useLocale();
  const s = pick(locale, BAZAAR_STRINGS);
  if (themeView.options.homeShowBrands === false) return null;
  if (brands.length === 0) return null;

  return (
    <section className="mt-12" aria-label={s.ourBrandsAria}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-extrabold text-text-main sm:text-2xl">
            {s.ourBrands}
          </h2>
          <span aria-hidden="true" className="mt-1.5 block h-[3px] w-10 rounded-full bg-primary" />
        </div>
        <Link
          href="/shop"
          className="inline-flex min-h-[44px] shrink-0 items-center text-sm font-bold text-primary hover:underline"
        >
          {s.seeAll}
        </Link>
      </div>
      <div className={`scrollbar-none -mx-4 mt-5 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 ${RAIL_FADE_CLASS}`}>
        {brands.map((name) => (
          <Link
            key={name}
            href={`/shop?brand=${encodeURIComponent(name)}`}
            className="flex h-[72px] w-[160px] shrink-0 snap-start items-center justify-center rounded-lg border border-border bg-card px-3 text-center shadow-card transition duration-200 hover:shadow-lift"
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
