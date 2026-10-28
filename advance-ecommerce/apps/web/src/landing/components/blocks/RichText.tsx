/**
 * Rich-text block body (doc 34 §3.2, L3) — markdown-lite ONLY.
 *
 * The body is rendered by renderDescriptionHtml
 * (src/catalog/description.ts), the SAME escape-first renderer the
 * PDP description and the blog use: the raw input is HTML-escaped
 * BEFORE any construct is applied, then only headings, bold/italic,
 * http(s)-only links and bullet lists are produced. Raw HTML in the
 * owner's text therefore reaches the page as visible escaped text,
 * never as markup — there is no unsanitized-HTML path here (§5
 * decision 1: no custom HTML block, this renderer is the ceiling).
 * The class set mirrors the PDP DescriptionSection's prose styling
 * so long-form copy reads identically across the storefront.
 */
import { renderDescriptionHtml } from "@/catalog/description";

export function RichText({ body }: { body: string }) {
  const html = renderDescriptionHtml(body);
  if (!html) return null;
  return (
    <div
      className="prose-sm max-w-none break-words text-[15px] leading-8 text-text-muted [overflow-wrap:anywhere] [&_a]:text-brand-700 [&_a]:underline [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-text-main [&_h3]:mb-1.5 [&_h3]:mt-5 [&_h3]:font-display [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-text-main [&_h4]:mb-1 [&_h4]:mt-4 [&_h4]:font-semibold [&_h4]:text-text-main [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-3 [&_strong]:text-text-main [&_ul]:list-disc"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
