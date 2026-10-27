/**
 * /faq — Frequently Asked Questions. Agent 29.
 * 10 Q&A (full {bn, en}) from src/legal/content.ts; one answer links to
 * /track (order tracking), others to /shipping-policy and /refund-policy.
 * Locale resolves per request (doc 30): visitor cookie → store default.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { FAQ_CONTENT, LEGAL_LAST_UPDATED_DRAFT } from "@/legal/content";
import { getRequestLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const content = FAQ_CONTENT[locale];
  return {
    title: `${content.title} — Advance Ecommerce`,
    description: content.description,
  };
}

export default async function FaqPage() {
  const locale = await getRequestLocale();
  const content = FAQ_CONTENT[locale];
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold leading-relaxed">{content.title}</h1>
      <p className="mt-1 text-sm leading-[1.9] text-slate-500">{content.intro}</p>
      <p className="mt-1 text-xs text-slate-400">
        {locale === "bn"
          ? `DRAFT — খসড়া: সর্বশেষ হালনাগাদ (খসড়া): ${LEGAL_LAST_UPDATED_DRAFT}`
          : `DRAFT — Last updated (draft): ${LEGAL_LAST_UPDATED_DRAFT}`}
      </p>
      <div className="mt-6 space-y-4">
        {content.items.map((item) => (
          <section
            key={item.question}
            className="rounded-[10px] border border-slate-200 p-4"
          >
            <h2 className="text-base font-semibold leading-relaxed">
              {item.question}
            </h2>
            <p className="mt-2 text-sm leading-[1.9] text-slate-600">
              {item.answer}
            </p>
            {item.linkHref && item.linkLabel ? (
              <Link
                href={item.linkHref}
                className="mt-2 inline-block text-sm font-medium text-[#4F46E5] underline"
              >
                {item.linkLabel}
              </Link>
            ) : null}
          </section>
        ))}
      </div>
    </main>
  );
}
