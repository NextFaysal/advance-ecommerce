"use client";

/**
 * PDP description (Wave 14-2, doc 16 §P5). The HTML is rendered
 * SERVER-side by renderDescriptionHtml (src/catalog/description.ts) —
 * the one renderer allowed to produce markup from merchant text (it
 * escapes/sanitizes); this component only switches between the Bangla
 * HTML and the English HTML when an English description exists. No
 * merchant text is ever injected raw here beyond that renderer's
 * output.
 */
import { useState } from "react";

export function DescriptionSection({
  bnHtml,
  enHtml,
}: {
  bnHtml: string;
  enHtml: string | null;
}) {
  const [lang, setLang] = useState<"bn" | "en">("bn");
  const html = lang === "en" && enHtml ? enHtml : bnHtml;
  return (
    <section className="mt-10 rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-extrabold text-text-main">পণ্যের বিবরণ</h2>
        {enHtml ? (
          <div className="flex rounded-full border border-border bg-surface-2/60 p-1 text-[13px] font-semibold" role="group" aria-label="বিবরণের ভাষা">
            <button
              type="button"
              onClick={() => setLang("bn")}
              aria-pressed={lang === "bn"}
              className={`inline-flex min-h-[44px] items-center rounded-full px-4 transition duration-200 ${lang === "bn" ? "bg-brand-600 text-white shadow-sm" : "text-text-muted hover:text-text-main"}`}
            >
              বাংলা
            </button>
            <button
              type="button"
              onClick={() => setLang("en")}
              aria-pressed={lang === "en"}
              className={`inline-flex min-h-[44px] items-center rounded-full px-4 transition duration-200 ${lang === "en" ? "bg-brand-600 text-white shadow-sm" : "text-text-muted hover:text-text-main"}`}
            >
              English
            </button>
          </div>
        ) : null}
      </div>
      <div
        className="prose-sm mt-4 max-w-3xl break-words text-[15px] leading-8 text-text-muted [overflow-wrap:anywhere] [&_a]:text-brand-700 [&_a]:underline [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-text-main [&_h3]:mb-1.5 [&_h3]:mt-5 [&_h3]:font-display [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-text-main [&_h4]:mb-1 [&_h4]:mt-4 [&_h4]:font-semibold [&_h4]:text-text-main [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-3 [&_strong]:text-text-main [&_ul]:list-disc"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </section>
  );
}
