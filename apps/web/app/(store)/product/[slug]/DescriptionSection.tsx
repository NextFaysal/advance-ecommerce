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
    <section className="mt-10 rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-extrabold text-text-main">পণ্যের বিবরণ</h2>
        {enHtml ? (
          <div className="flex rounded-full border border-border p-0.5 text-[13px] font-semibold" role="group" aria-label="বিবরণের ভাষা">
            <button
              type="button"
              onClick={() => setLang("bn")}
              aria-pressed={lang === "bn"}
              className={`rounded-full px-3.5 py-1.5 transition ${lang === "bn" ? "bg-brand-600 text-white" : "text-text-muted hover:text-text-main"}`}
            >
              বাংলা
            </button>
            <button
              type="button"
              onClick={() => setLang("en")}
              aria-pressed={lang === "en"}
              className={`rounded-full px-3.5 py-1.5 transition ${lang === "en" ? "bg-brand-600 text-white" : "text-text-muted hover:text-text-main"}`}
            >
              English
            </button>
          </div>
        ) : null}
      </div>
      <div
        className="prose-sm mt-3 max-w-3xl break-words text-[15px] leading-8 text-text-muted [overflow-wrap:anywhere] [&_a]:text-brand-700 [&_a]:underline [&_li]:ml-5 [&_ol]:list-decimal [&_strong]:text-text-main [&_ul]:list-disc"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </section>
  );
}
