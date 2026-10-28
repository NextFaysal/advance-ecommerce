/**
 * Shared renderer for legal/info pages — Agent 29.
 * Renders a LegalPageContent in the locale the page resolved
 * (doc 30: getRequestLocale — visitor cookie → store default), with a
 * DRAFT badge and the "last updated (draft)" date in that same locale.
 * Server component, no client JS.
 *
 * Doc 32 P7 (typography pass): display title, token colours (the old
 * hardcoded slates didn't flip in the dark themes), wider prose
 * rhythm, and a section TOC on long pages — the view already splits
 * content into sections, so the TOC is pure anchor links (ids are
 * positional, content order untouched). Print keeps the prose and
 * drops the TOC chrome.
 */
import type { LegalPageContent } from "./content";
import type { Locale } from "@/i18n/locale";

/** Pages with at least this many sections get a table of contents. */
const TOC_MIN_SECTIONS = 3;

export default function LegalPageView({
  content,
  locale,
}: {
  content: LegalPageContent;
  locale: Locale;
}) {
  const showToc = content.sections.length >= TOC_MIN_SECTIONS;
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold leading-snug text-text-main">
        {content.title}
      </h1>
      <p className="mt-3 rounded-2xl bg-warning-soft px-4 py-2.5 text-xs font-medium leading-5 text-warning-solid">
        {locale === "bn"
          ? `DRAFT — খসড়া: সর্বশেষ হালনাগাদ (খসড়া): ${content.lastUpdatedDraft}। লাইভ হওয়ার আগে মালিককে এই লেখা যাচাই করে নিতে হবে।`
          : `DRAFT — Last updated (draft): ${content.lastUpdatedDraft} — the owner must review this text before going live.`}
      </p>

      {showToc ? (
        <nav
          aria-label={locale === "bn" ? "সূচিপত্র" : "Contents"}
          className="mt-8 rounded-2xl border border-border bg-card p-5 shadow-card print:hidden"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
            {locale === "bn" ? "সূচিপত্র" : "Contents"}
          </p>
          <ol className="mt-3 space-y-1">
            {content.sections.map((section, index) => (
              <li key={section.heading}>
                <a
                  href={`#section-${index + 1}`}
                  className="focus-ring flex min-h-[44px] items-center gap-2.5 rounded-lg px-2 text-sm font-medium text-text-main transition hover:bg-surface-2 hover:text-brand-700 sm:min-h-0 sm:py-1.5"
                >
                  <span aria-hidden="true" className="text-xs font-semibold text-text-subtle">
                    {index + 1}.
                  </span>
                  {section.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <div className="mt-8 space-y-8">
        {content.sections.map((section, index) => (
          <section key={section.heading} id={`section-${index + 1}`} className="scroll-mt-24">
            <h2 className="font-display text-lg font-bold leading-relaxed text-text-main">
              {section.heading}
            </h2>
            {section.paragraphs.map((paragraph, pIndex) => (
              <p
                key={pIndex}
                className="mt-2.5 text-sm leading-[1.9] text-text-muted"
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
