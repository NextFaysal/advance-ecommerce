/**
 * Branded 404 for the storefront (replaces the framework default).
 *
 * Doc 32 P7: the copy used to be hardcoded Bangla here — it now comes
 * from COMMON_STRINGS (bn originals verbatim, en added), resolved per
 * request exactly like the legal pages (doc 30: visitor cookie →
 * store default). Below the message: a plain GET search form (the
 * same /search?q= contract the header uses), category shortcuts from
 * the cached public catalog read (name picked [locale] || bn), and
 * useful-link shortcuts from the shared dictionary. Everything here
 * degrades gracefully: with no catalog repository the category row
 * simply doesn't render.
 */
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { COMMON_STRINGS } from "@/i18n/dictionaries";
import { pick } from "@/i18n/locale";
import { getRequestLocale } from "@/i18n/server";
import { listCategories } from "@/catalog/server-read";

export default async function NotFound() {
  const locale = await getRequestLocale();
  const t = pick(locale, COMMON_STRINGS);

  const categories = await listCategories().catch(() => []);
  const topCategories = categories.filter((c) => c.productCount > 0).slice(0, 6);

  const shortcuts = [
    { href: "/shop", label: t.allProducts },
    { href: "/track", label: t.trackOrder },
    { href: "/wishlist", label: t.wishlist },
    { href: "/faq", label: t.faq },
    { href: "/contact", label: t.contactUs },
  ];

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center px-6 py-20 text-center">
      <p className="brand-gradient bg-clip-text text-7xl font-extrabold text-transparent">404</p>
      <h1 className="mt-4 text-2xl font-bold text-text-main">{t.notFoundTitle}</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-text-muted">{t.notFoundBody}</p>

      <form action="/search" method="get" role="search" className="mt-8 w-full max-w-md">
        <label className="sr-only" htmlFor="not-found-search">
          {t.search}
        </label>
        <div className="flex items-center gap-2 rounded-full border border-border bg-card p-1.5 shadow-card transition focus-within:border-brand-400">
          <span aria-hidden="true" className="pl-2.5 text-text-subtle">
            <Icon name="search" size={18} />
          </span>
          <input
            id="not-found-search"
            name="q"
            type="search"
            autoComplete="off"
            placeholder={t.searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-sm text-text-main outline-none placeholder:text-text-subtle"
          />
          <button
            type="submit"
            className="brand-gradient focus-ring flex min-h-[44px] shrink-0 items-center rounded-full px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
          >
            {t.search}
          </button>
        </div>
      </form>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/shop"
          className="brand-gradient focus-ring flex min-h-[44px] items-center rounded-xl px-6 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
        >
          {t.notFoundShopCta}
        </Link>
        <Link
          href="/"
          className="focus-ring flex min-h-[44px] items-center rounded-xl border border-border bg-card px-6 text-sm font-semibold text-text-main transition hover:bg-surface-2"
        >
          {t.notFoundHomeCta}
        </Link>
      </div>

      {topCategories.length > 0 ? (
        <nav aria-label={t.notFoundCategoriesLabel} className="mt-10 w-full max-w-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
            {t.notFoundCategoriesLabel}
          </p>
          <ul className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {topCategories.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/shop?category=${c.slug}`}
                  className="focus-ring inline-flex min-h-[44px] items-center rounded-full border border-border bg-card px-4 text-sm font-medium text-text-main transition hover:border-brand-300 hover:text-brand-700"
                >
                  {c.name[locale] || c.name.bn}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <nav aria-label={t.notFoundShortcutsLabel} className="mt-8">
        <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {shortcuts.map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                className="focus-ring inline-flex min-h-[44px] items-center text-sm font-medium text-brand-700 underline-offset-2 transition hover:underline"
              >
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
