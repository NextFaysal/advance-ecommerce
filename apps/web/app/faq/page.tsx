/**
 * /faq — Frequently Asked Questions. Agent 29.
 * 10 Q&A (full {bn, en}) from src/legal/content.ts; one answer links to
 * /track (order tracking), others to /shipping-policy and /refund-policy.
 * Locale: the store default (doc 30 static-surface rule) — this page
 * used to resolve the visitor's cookie locale per request via
 * getRequestLocale(), whose cookies() read forced the whole route
 * dynamic (no-store, full render per hit, ~4.5s RSC prefetches in
 * production). The content is deploy-time constants with no
 * per-visitor state, so it now renders exactly like the homepage:
 * ISR + force-static in the store-default language.
 *
 * Doc 32 P7: the stacked always-open sections became a native
 * <details> accordion (kit-standard card rows, 44px summary targets,
 * focus-visible rings, first item open) — no client JS, content and
 * links untouched. Colours moved from hardcoded slates/indigo to the
 * design tokens so the page flips correctly in the dark themes.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { FAQ_CONTENT, LEGAL_LAST_UPDATED_DRAFT } from "@/legal/content";
import { getStoreDefaultLocale } from "@/i18n/server";

// Speed fix (2026-10-29): ISR + force-static, the same pin the
// homepage and PDP carry. revalidate 300 matches the blog/CMS
// cadence (this page's content is editorial constants); the
// force-static pin is what actually keeps the route in the
// prerender manifest — under auto mode a route in this tree can
// silently opt out of static generation and serve no-store.
export const revalidate = 300;
export const dynamic = "force-static";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getStoreDefaultLocale();
  const content = FAQ_CONTENT[locale];
  return {
    title: `${content.title} — Advance Ecommerce`,
    description: content.description,
  };
}

export default async function FaqPage() {
  const locale = await getStoreDefaultLocale();
  const content = FAQ_CONTENT[locale];
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold leading-snug text-text-main">
        {content.title}
      </h1>
      <p className="mt-2 text-sm leading-[1.9] text-text-muted">{content.intro}</p>
      <p className="mt-2 text-xs text-text-subtle">
        {locale === "bn"
          ? `DRAFT — খসড়া: সর্বশেষ হালনাগাদ (খসড়া): ${LEGAL_LAST_UPDATED_DRAFT}`
          : `DRAFT — Last updated (draft): ${LEGAL_LAST_UPDATED_DRAFT}`}
      </p>
      <div className="mt-6 space-y-3">
        {content.items.map((item, index) => (
          <details
            key={item.question}
            open={index === 0}
            className="group rounded-2xl border border-border bg-card shadow-card"
          >
            <summary className="focus-ring flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 py-4 text-base font-semibold leading-relaxed text-text-main transition hover:text-brand-700 [&::-webkit-details-marker]:hidden">
              {item.question}
              <span
                aria-hidden="true"
                className="shrink-0 text-text-subtle transition duration-200 group-open:rotate-180"
              >
                <Icon name="chevron-down" size={18} />
              </span>
            </summary>
            <div className="px-5 pb-5">
              <p className="text-sm leading-[1.9] text-text-muted">{item.answer}</p>
              {item.linkHref && item.linkLabel ? (
                <Link
                  href={item.linkHref}
                  className="focus-ring mt-3 inline-flex min-h-[44px] items-center rounded-lg text-sm font-semibold text-brand-700 underline-offset-2 transition hover:underline"
                >
                  {item.linkLabel}
                </Link>
              ) : null}
            </div>
          </details>
        ))}
      </div>
    </main>
  );
}
