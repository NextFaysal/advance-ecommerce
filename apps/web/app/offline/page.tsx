import type { Metadata } from "next";
import { COMMON_STRINGS } from "@/i18n/dictionaries";
import { pick } from "@/i18n/locale";
import { getRequestLocale } from "@/i18n/server";
import RetryButton from "./RetryButton";

/**
 * Offline fallback page — Agent 12 base, designed in the Design v3
 * responsive/PWA pass. public/sw.js precaches this URL at install and
 * serves it when a navigation fails with no cached copy; the storefront
 * shell renders no header/footer on /offline, so the page is fully
 * self-contained. It stays dependency-light: no data fetching beyond
 * the request locale, and the page renders completely without client
 * JS (the retry button is a small client island; the home link always
 * works).
 *
 * Doc 32 P7: the copy used to be hardcoded Bangla (page + metadata) —
 * it now comes from COMMON_STRINGS (bn originals verbatim, en added),
 * resolved per request like every other platform page (doc 30:
 * visitor cookie → store default). The cached copy the SW serves is
 * whichever locale was resolved when it was fetched.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const t = pick(locale, COMMON_STRINGS);
  return {
    title: t.offlineMetaTitle,
    description: t.offlineMetaDescription,
    robots: { index: false, follow: false },
  };
}

function WifiOffMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="30"
      height="30"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.55a11 11 0 0 1 5.17-2.39" />
      <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
      <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <path d="M12 20h.01" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

export default async function OfflinePage() {
  const locale = await getRequestLocale();
  const t = pick(locale, COMMON_STRINGS);
  return (
    <main className="brand-soft-gradient flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-7 text-center shadow-pop">
        <span className="brand-gradient mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-lift">
          <WifiOffMark />
        </span>
        <h1 className="font-display mt-5 text-h2 text-text-main">{t.offlineTitle}</h1>
        <p className="mt-2 text-sm leading-6 text-text-muted">{t.offlineBody}</p>
        <div className="mt-6 flex flex-col gap-2.5">
          <RetryButton label={t.offlineRetry} />
          <a
            href="/"
            className="focus-ring flex h-12 items-center justify-center rounded-xl border border-border bg-card px-6 text-sm font-semibold text-text-main transition hover:bg-surface-2"
          >
            {t.offlineHomeCta}
          </a>
        </div>
        <p className="mt-5 text-xs leading-5 text-text-subtle">{t.offlineFootnote}</p>
      </div>
    </main>
  );
}
