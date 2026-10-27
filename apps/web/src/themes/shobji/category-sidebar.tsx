"use client";

/**
 * Shobji category sidebar — this package's layout signature
 * (doc 27 theme T-B).
 *
 * A persistent LEFT rail of REAL categories rendered beside the
 * home content (home-sections.tsx) and beside the shop results
 * (shop-chrome.tsx). Every row is a real link to
 * /shop?category=<slug>; the active row (when the caller knows the
 * current category slug) gets the filled purple treatment; each
 * row shows the category's REAL productCount from props — nothing
 * is counted, ranked or invented here.
 *
 * The component reads the package's `showSidebar` option from the
 * ThemeView context: off → it renders null, and the callers'
 * two-column grids collapse via their own conditional classes.
 * On mobile the desktop rail is hidden with CSS and the header
 * renders the same links as a horizontal scroll strip — the
 * collapse is presentational only.
 *
 * Client component on purpose: it reads the ThemeView context,
 * and both callers (a server composition and a client chrome)
 * mount it the same way.
 */
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { useDigitText } from "@/components/ui/numerals";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { useThemeView } from "../theme-view";
import { SHOBJI_STRINGS } from "./strings";

export interface ShobjiSidebarCategory {
  slug: string;
  nameBn: string;
  productCount: number;
}

export default function ShobjiCategorySidebar({
  categories,
  activeCategorySlug,
}: {
  categories: ReadonlyArray<ShobjiSidebarCategory>;
  /** The slug of the category being browsed, when derivable. */
  activeCategorySlug?: string;
}) {
  const digits = useDigitText();
  const { locale } = useLocale();
  const s = pick(locale, SHOBJI_STRINGS);
  const themeView = useThemeView();
  if (themeView.options.showSidebar === false) return null;
  if (categories.length === 0) return null;

  const allActive = !activeCategorySlug;

  return (
    <nav
      aria-label={s.categorySidebarAria}
      className="hidden w-[220px] shrink-0 lg:block xl:w-[240px]"
    >
      <div className="sticky top-[5.5rem] overflow-hidden rounded-lg border border-border bg-card shadow-card">
        <p className="flex items-center gap-2 bg-secondary px-4 py-3 text-sm font-extrabold text-secondary-foreground">
          <Icon name="grid" size={16} />
          {s.categories}
        </p>
        <ul className="max-h-[70vh] overflow-y-auto py-1.5">
          <li>
            <Link
              href="/shop"
              aria-current={allActive ? "true" : undefined}
              className={`flex min-h-[40px] items-center gap-2 px-4 py-2 text-sm transition duration-200 ${
                allActive
                  ? "bg-primary font-bold text-white"
                  : "text-text-muted hover:bg-muted hover:text-text-main"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{s.allProducts}</span>
            </Link>
          </li>
          {categories.map((c) => {
            const active = activeCategorySlug === c.slug;
            return (
              <li key={c.slug}>
                <Link
                  href={`/shop?category=${c.slug}`}
                  aria-current={active ? "true" : undefined}
                  className={`flex min-h-[40px] items-center gap-2 px-4 py-2 text-sm transition duration-200 ${
                    active
                      ? "bg-primary font-bold text-white"
                      : "text-text-muted hover:bg-muted hover:text-text-main"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{c.nameBn}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] tabular-nums ${
                      active ? "bg-white/20 text-white" : "bg-muted text-text-subtle"
                    }`}
                  >
                    {digits(`${c.productCount}`)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
