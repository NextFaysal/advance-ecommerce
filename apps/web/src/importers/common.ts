// Shared helpers for the ADV-25 source mappers: header normalisation
// + alias lookup, slugify, HTML stripping, and CSV serialisation for
// the platform's native import format.

/**
 * Normalise a source header for alias matching: lower-case, every run
 * of non-alphanumerics becomes one underscore ("Regular price" ->
 * "regular_price", "In stock?" -> "in_stock", "Body (HTML)" ->
 * "body_html").
 */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** A source table with normalised keys plus the original headers. */
export interface NormalizedTable {
  originalHeaders: string[];
  rows: Record<string, string>[];
}

export function normalizeTable(table: {
  headers: string[];
  rows: Record<string, string>[];
}): NormalizedTable {
  const keyMap = new Map<string, string>();
  for (const h of table.headers) keyMap.set(h, normalizeHeader(h));
  const rows = table.rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [orig, norm] of keyMap) out[norm] = row[orig] ?? "";
    return out;
  });
  return { originalHeaders: table.headers, rows };
}

/** First non-empty cell among the alias keys, trimmed. */
export function pick(row: Record<string, string>, aliases: string[]): string {
  for (const key of aliases) {
    const v = (row[key] ?? "").trim();
    if (v !== "") return v;
  }
  return "";
}

/** Original headers whose normalised form is in `consumed`. */
export function splitColumns(
  originalHeaders: string[],
  consumed: Set<string>,
): { consumedColumns: string[]; unmappedColumns: string[] } {
  const consumedColumns: string[] = [];
  const unmappedColumns: string[] = [];
  for (const h of originalHeaders) {
    if (consumed.has(normalizeHeader(h))) consumedColumns.push(h);
    else unmappedColumns.push(h);
  }
  return { consumedColumns, unmappedColumns };
}

/**
 * Slugify arbitrary source text into the platform slug shape
 * (^[a-z0-9]+(?:-[a-z0-9]+)*$). Latin diacritics are folded; scripts
 * with no Latin representation (e.g. pure Bengali) yield "" — callers
 * decide the fallback, the mapper never invents a name silently.
 */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Deepest segment of a category path: "Clothing > Shirts" -> "Shirts". */
export function deepestCategorySegment(pathCell: string): string {
  // A categories cell may list several paths separated by commas;
  // the first listed path is the primary one in Woo/Shopify exports.
  const firstPath = pathCell.split(",")[0] ?? "";
  const segments = firstPath.split(">").map((s) => s.trim()).filter((s) => s !== "");
  return segments[segments.length - 1] ?? "";
}

/** Comma-separated tag cell -> the platform's "|" separator. */
export function convertTags(cell: string): string {
  return cell
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "")
    .join("|");
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Strip HTML to plain text (Woo/Shopify descriptions are HTML). */
export function stripHtml(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n");
  const noTags = withBreaks.replace(/<[^>]*>/g, "");
  const decoded = noTags.replace(
    /&(?:amp|lt|gt|quot|apos|nbsp);|&#39;/g,
    (m) => HTML_ENTITIES[m] ?? m,
  );
  return decoded
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Light markdown strip for outbound feeds (descriptions are markdown). */
export function stripMarkdown(md: string): string {
  return stripHtml(
    md
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
      .replace(/^>\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "• "),
  ).replace(/\s+/g, " ").trim();
}

function csvEscape(value: string): string {
  return value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

export function buildCsv(headers: string[], rows: Record<string, string>[]): string {
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((h) => csvEscape(row[h] ?? "")).join(","));
  return lines.join("\n");
}

/** XML text escape for feed builders. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** First URL of a comma-separated image cell (Woo "Images"). */
export function firstImageUrl(cell: string): string {
  const first = cell.split(",").map((s) => s.trim()).find((s) => s !== "");
  return first ?? "";
}

/**
 * Hands out unique slugs within one file. Two different source
 * products can slugify to the same value ("T-Shirt" / "T Shirt") and
 * the pipeline would merge them into one product — so collisions get
 * a numeric suffix and are recorded in `adjusted` for the report.
 */
export class SlugAllocator {
  private used = new Map<string, number>();
  readonly adjusted: { base: string; slug: string }[] = [];

  allocate(base: string): string {
    if (base === "") return "";
    const count = this.used.get(base) ?? 0;
    this.used.set(base, count + 1);
    if (count === 0) return base;
    const slug = `${base}-${count + 1}`;
    this.adjusted.push({ base, slug });
    return slug;
  }
}

/**
 * Stock cell normalisation shared by the product mappers. Empty cell
 * means "not stock-managed in the source" -> 0 (counted for the
 * report). A negative integer (Woo/Shopify allow backorder negatives)
 * is clamped to 0 and the SKU recorded — the transformation is always
 * reported, never silent. Non-numeric cells pass through untouched so
 * the pipeline itself reports them as invalid.
 */
export function normalizeStockCell(
  raw: string,
  stats: { unmanaged: number; clampedSkus: string[] },
  sku: string,
): string {
  const cell = raw.trim();
  if (cell === "") {
    stats.unmanaged += 1;
    return "0";
  }
  if (/^-\d+$/.test(cell)) {
    stats.clampedSkus.push(sku || "(no sku)");
    return "0";
  }
  return cell;
}
