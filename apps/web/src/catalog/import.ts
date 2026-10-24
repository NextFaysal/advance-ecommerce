// CSV import — Agent 8 (Step 10 contract).
// Rules (no silent drops):
//  - Every row is classified valid OR invalid. Invalid rows are returned
//    with row number, field, and message, and are NEVER silently skipped.
//  - Duplicate SKU inside the file is an error. Duplicate SKU against
//    existing products is an error (caller passes existing SKUs).
//  - Money is integer poisha in the file (column price_poisha). A taka
//    column is NOT accepted here — converting taka->poisha in import
//    is a classic rounding bug, so the file format is poisha-only.
//  - Header row is required. Unknown columns are ignored, missing
//    required columns fail the whole preview with a clear error.

import { z } from "zod";

export const IMPORT_HEADERS = [
  "slug",
  "title_bn",
  "title_en",
  "description_bn",
  "description_en",
  "category_slug",
  "brand_name",
  "status",
  "tags",
  "sku",
  "price_poisha",
  "compare_at_poisha",
  "cost_poisha",
  "stock",
  "image_url",
] as const;

const rowSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid slug"),
  title_bn: z.string().min(1),
  title_en: z.string().min(1),
  description_bn: z.string().min(1),
  description_en: z.string().min(1),
  category_slug: z.string().min(1),
  brand_name: z.string().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("DRAFT"),
  tags: z.string().optional(),
  sku: z.string().min(1),
  price_poisha: z.number().int().min(0),
  compare_at_poisha: z.number().int().min(0).nullable().optional(),
  cost_poisha: z.number().int().min(0).nullable().optional(),
  stock: z.number().int().min(0),
  image_url: z.string().optional(),
});

export type ImportRow = z.infer<typeof rowSchema>;

export interface ImportRowError {
  row: number; // 1-based data row (header = row 1 in the file, first data row = 2)
  field: string;
  message: string;
}

export interface ImportPreview {
  totalRows: number;
  validRows: ImportRow[];
  invalidRows: { row: number; raw: Record<string, string>; errors: ImportRowError[] }[];
  errorReportCsv: string;
}

/** Minimal CSV parser: quoted fields, escaped quotes, CRLF. No external dep. */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    current.push(field);
    field = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      pushField();
      lines.push(current);
      current = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || current.length > 0) {
    pushField();
    lines.push(current);
  }
  const nonEmpty = lines.filter((l) => l.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const headers = (nonEmpty[0] as string[]).map((h) => h.trim().toLowerCase());
  const rows = nonEmpty.slice(1).map((cols) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (cols[idx] ?? "").trim();
    });
    return obj;
  });
  return { headers, rows };
}

function toIntOrNull(value: string): number | null | undefined {
  if (value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : undefined;
}

export function previewImport(csvText: string, existingSkus: Set<string>): ImportPreview {
  const { headers, rows } = parseCsv(csvText);
  const missing = ["slug", "title_bn", "title_en", "sku", "price_poisha", "stock"].filter(
    (h) => !headers.includes(h),
  );
  if (missing.length > 0) {
    return {
      totalRows: rows.length,
      validRows: [],
      invalidRows: rows.map((raw, idx) => ({
        row: idx + 2,
        raw,
        errors: missing.map((f) => ({ row: idx + 2, field: f, message: `Missing required column: ${f}` })),
      })),
      errorReportCsv: buildErrorReportCsv(
        rows.map((raw, idx) => ({
          row: idx + 2,
          raw,
          errors: missing.map((f) => ({ row: idx + 2, field: f, message: `Missing required column: ${f}` })),
        })),
      ),
    };
  }
  const validRows: ImportRow[] = [];
  const invalidRows: ImportPreview["invalidRows"] = [];
  const seenSkus = new Set<string>();
  rows.forEach((raw, idx) => {
    const rowNo = idx + 2;
    const errors: ImportRowError[] = [];
    const price = toIntOrNull(raw.price_poisha ?? "");
    const stock = toIntOrNull(raw.stock ?? "");
    if (price === undefined) errors.push({ row: rowNo, field: "price_poisha", message: "Must be an integer (poisha)" });
    if (stock === undefined) errors.push({ row: rowNo, field: "stock", message: "Must be an integer" });
    const parsed = rowSchema.safeParse({
      ...raw,
      price_poisha: price ?? -1,
      compare_at_poisha: toIntOrNull(raw.compare_at_poisha ?? ""),
      cost_poisha: toIntOrNull(raw.cost_poisha ?? ""),
      stock: stock ?? -1,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({ row: rowNo, field: issue.path.join(".") || "row", message: issue.message });
      }
    }
    const sku = raw.sku ?? "";
    if (sku && seenSkus.has(sku)) errors.push({ row: rowNo, field: "sku", message: `Duplicate SKU in file: ${sku}` });
    if (sku) seenSkus.add(sku);
    if (sku && existingSkus.has(sku)) errors.push({ row: rowNo, field: "sku", message: `SKU already exists: ${sku}` });
    if (errors.length > 0 || !parsed.success) {
      invalidRows.push({ row: rowNo, raw, errors });
    } else if (parsed.success) {
      validRows.push(parsed.data);
    }
  });
  return { totalRows: rows.length, validRows, invalidRows, errorReportCsv: buildErrorReportCsv(invalidRows) };
}

export function buildErrorReportCsv(invalidRows: ImportPreview["invalidRows"]): string {
  const escape = (v: string) => (v.includes(",") || v.includes('"') || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ["row,field,message"];
  for (const r of invalidRows) {
    for (const e of r.errors) lines.push(`${r.row},${escape(e.field)},${escape(e.message)}`);
  }
  return lines.join("\n");
}

/** Group valid import rows by slug into product payloads (one product, many variants). */
export function groupImportRowsByProduct(rows: ImportRow[]): Record<string, ImportRow[]> {
  const grouped: Record<string, ImportRow[]> = {};
  for (const row of rows) {
    (grouped[row.slug] ??= []).push(row);
  }
  return grouped;
}
