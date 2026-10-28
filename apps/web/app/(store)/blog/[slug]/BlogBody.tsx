"use client";

/**
 * Blog post body (ADV-17). HTML arrives rendered SERVER-side by
 * renderDescriptionHtml (src/catalog/description.ts) — the same
 * escaping renderer the PDP uses — this component only switches
 * between the Bangla HTML and the English HTML when an English body
 * exists. Mirrors the PDP DescriptionSection pattern exactly.
 */
import { useState } from "react";

export function BlogBody({
  bnHtml,
  enHtml,
}: {
  bnHtml: string;
  enHtml: string | null;
}) {
  const [lang, setLang] = useState<"bn" | "en">("bn");
  const html = lang === "en" && enHtml ? enHtml : bnHtml;
  return (
    <div>
      {enHtml ? (
        <div className="mb-4 flex justify-end">
          <div className="flex rounded-full border border-border bg-surface-2/60 p-1 text-[13px] font-semibold" role="group" aria-label="লেখার ভাষা">
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
        </div>
      ) : null}
      <div
        className="prose-sm max-w-none break-words text-[15px] leading-8 text-text-muted [overflow-wrap:anywhere] [&_a]:text-brand-700 [&_a]:underline [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-brand-300 [&_blockquote]:pl-4 [&_blockquote]:italic [&_h2]:mb-2 [&_h2]:mt-7 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-text-main [&_h3]:mb-1.5 [&_h3]:mt-6 [&_h3]:font-display [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-text-main [&_h4]:mb-1 [&_h4]:mt-4 [&_h4]:font-semibold [&_h4]:text-text-main [&_hr]:my-6 [&_hr]:border-border [&_img]:my-4 [&_img]:rounded-2xl [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-3.5 [&_strong]:text-text-main [&_ul]:list-disc"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
