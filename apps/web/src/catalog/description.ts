// Product description renderer — wave 14 (doc 16 P5). SHARED contract:
// the admin product editor's live preview and the storefront PDP both
// render through here, so what the merchant previews is exactly what
// the customer sees.
//
// Supported markdown subset (deliberately small):
//   # / ## / ### headings   (rendered as h2 / h3 / h4 — the PDP's h1
//                            is the product title)
//   **bold**   *italic*
//   [text](https://…) links (http/https ONLY — anything else renders
//                            as plain text, never an anchor)
//   - or * bullet lists     (consecutive lines group into one <ul>)
//   blank-line-separated paragraphs; single newlines become <br/>
//
// SAFETY: the raw input is HTML-escaped FIRST and every construct
// below operates on the escaped text, so no raw HTML from a
// description can ever reach the page. Link URLs are taken from the
// escaped text too (a `"` in the URL is already `&quot;`, so the href
// attribute cannot be broken out of), and only http/https URLs are
// linkified at all.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Inline constructs, applied to ALREADY-escaped text. */
function renderInline(escaped: string): string {
  let out = escaped;
  // Links first (their text may still carry bold/italic markers,
  // which the passes below then format inside the anchor).
  out = out.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, text: string, url: string) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`,
  );
  // A bracketed label whose URL is not http/https stays literal text.
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  return out;
}

export function renderDescriptionHtml(md: string): string {
  const escaped = escapeHtml(md ?? "");
  const lines = escaped.split(/\r?\n/);
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${paragraph.map(renderInline).join("<br/>")}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length > 0) {
      blocks.push(`<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
      list = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (trimmed === "") {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      const level = (heading[1] ?? "#").length + 1; // # -> h2, ## -> h3, ### -> h4
      blocks.push(`<h${level}>${renderInline(heading[2] ?? "")}</h${level}>`);
    } else if (bullet) {
      flushParagraph();
      list.push(bullet[1] ?? "");
    } else {
      flushList();
      paragraph.push(trimmed);
    }
  }
  flushParagraph();
  flushList();
  return blocks.join("\n");
}

/**
 * Plain-text view of a description (meta descriptions, search
 * snippets): markdown markers stripped, link labels kept (URLs
 * dropped), whitespace collapsed. Operates on the RAW markdown.
 */
export function descriptionToPlainText(md: string): string {
  return (md ?? "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
