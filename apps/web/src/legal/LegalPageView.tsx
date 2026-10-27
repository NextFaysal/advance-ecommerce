/**
 * Shared renderer for legal/info pages — Agent 29.
 * Renders a LegalPageContent in the locale the page resolved
 * (doc 30: getRequestLocale — visitor cookie → store default), with a
 * DRAFT badge and the "last updated (draft)" date in that same locale.
 * Server component, no client JS.
 */
import type { LegalPageContent } from "./content";
import type { Locale } from "@/i18n/locale";

export default function LegalPageView({
  content,
  locale,
}: {
  content: LegalPageContent;
  locale: Locale;
}) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold leading-relaxed">{content.title}</h1>
      <p className="mt-2 text-xs text-slate-400">
        {locale === "bn"
          ? `DRAFT — খসড়া: সর্বশেষ হালনাগাদ (খসড়া): ${content.lastUpdatedDraft}। লাইভ হওয়ার আগে মালিককে এই লেখা যাচাই করে নিতে হবে।`
          : `DRAFT — Last updated (draft): ${content.lastUpdatedDraft} — the owner must review this text before going live.`}
      </p>
      <div className="mt-6 space-y-6">
        {content.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="text-base font-semibold leading-relaxed">
              {section.heading}
            </h2>
            {section.paragraphs.map((paragraph, index) => (
              <p
                key={index}
                className="mt-2 text-sm leading-[1.9] text-slate-600"
              >
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
