// CSV import — Agent 8 (Step 10 contract); taka columns added in P4.
// Rules (no silent drops):
//  - Every row is classified valid OR invalid. Invalid rows are returned
//    with row number, field, and message, and are NEVER silently skipped.
//  - Duplicate SKU inside the file is an error. Duplicate SKU against
//    existing products is an error (caller passes existing SKUs).
//  - Money: integer poisha columns (price_poisha) are the canonical
//    format. Decimal TAKA columns (price_taka) are ALSO accepted since
//    P4 — BD merchants keep catalogs in taka. Conversion is exact
//    decimal-string math (never float multiplication): the taka value
//    is rounded half-up at the third decimal place into integer poisha.
//    One row may use ONE unit per money field: a row that sets both
//    price_poisha and price_taka is an error, never a guess.
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

/** Decimal-taka alternatives to the *_poisha columns (P4). A row uses
 *  one unit per money field; the parsed output is always poisha. */
export const IMPORT_TAKA_HEADERS = ["price_taka", "compare_at_taka", "cost_taka"] as const;

export type MoneyUnit = "poisha" | "taka" | "mixed" | "none";

/** Which unit each money column used across the whole file, so the
 *  preview UI can show the merchant what was detected. "mixed" means
 *  different rows used different units (legal — the conflict rule is
 *  per-row, per-field). */
export interface ImportMoneyUnits {
  price: MoneyUnit;
  compareAt: MoneyUnit;
  cost: MoneyUnit;
}

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
  moneyUnits: ImportMoneyUnits;
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

/**
 * Decimal taka string -> integer poisha, exact string math (no floats):
 * "1250" -> 125000, "1250.5" -> 125050, "1250.505" -> 125051 (half-up
 * at the third decimal). Returns undefined for anything that is not a
 * plain non-negative decimal (negatives, thousand separators, text).
 */
export function takaStringToPoisha(value: string): number | undefined {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return undefined;
  const whole = Number(match[1] as string);
  const frac = match[2] ?? "";
  let cents = Number((frac + "00").slice(0, 2));
  if (frac.length > 2 && Number(frac[2] as string) >= 5) cents += 1;
  return whole * 100 + cents;
}

function detectMoneyUnits(rows: Record<string, string>[]): ImportMoneyUnits {
  const detect = (poishaKey: string, takaKey: string): MoneyUnit => {
    const usesPoisha = rows.some((r) => (r[poishaKey] ?? "").trim() !== "");
    const usesTaka = rows.some((r) => (r[takaKey] ?? "").trim() !== "");
    if (usesPoisha && usesTaka) return "mixed";
    if (usesPoisha) return "poisha";
    if (usesTaka) return "taka";
    return "none";
  };
  return {
    price: detect("price_poisha", "price_taka"),
    compareAt: detect("compare_at_poisha", "compare_at_taka"),
    cost: detect("cost_poisha", "cost_taka"),
  };
}

export function previewImport(csvText: string, existingSkus: Set<string>): ImportPreview {
  const { headers, rows } = parseCsv(csvText);
  return previewImportRows(headers, rows, existingSkus);
}

/**
 * The shared row pipeline: header/column checks, money-unit resolution
 * (poisha columns, or *_taka columns converted with exact decimal math)
 * and per-row validation. CSV text goes through parseCsv first; the
 * XLSX reader (import-xlsx.ts) produces the same { headers, rows }
 * string table — so spreadsheet imports obey identical semantics.
 */
export function previewImportRows(
  headers: string[],
  rows: Record<string, string>[],
  existingSkus: Set<string>,
): ImportPreview {
  const moneyUnits = detectMoneyUnits(rows);
  const missing = ["slug", "title_bn", "title_en", "sku", "stock"].filter(
    (h) => !headers.includes(h),
  );
  // Price is required, but EITHER unit's column satisfies the requirement.
  if (!headers.includes("price_poisha") && !headers.includes("price_taka")) {
    missing.push("price_poisha / price_taka");
  }
  if (missing.length > 0) {
    const invalidRows = rows.map((raw, idx) => ({
      row: idx + 2,
      raw,
      errors: missing.map((f) => ({ row: idx + 2, field: f, message: `Missing required column: ${f}` })),
    }));
    return {
      totalRows: rows.length,
      validRows: [],
      invalidRows,
      errorReportCsv: buildErrorReportCsv(invalidRows),
      moneyUnits,
    };
  }
  const validRows: ImportRow[] = [];
  const invalidRows: ImportPreview["invalidRows"] = [];
  const seenSkus = new Set<string>();
  rows.forEach((raw, idx) => {
    const rowNo = idx + 2;
    const errors: ImportRowError[] = [];
    // Resolve one money field from its poisha OR taka cell. Both cells
    // set in the same row = a conflict error (never guess a unit);
    // both empty = null (the caller decides whether that is an error).
    const resolveMoney = (poishaKey: string, takaKey: string): number | null => {
      const poishaCell = (raw[poishaKey] ?? "").trim();
      const takaCell = (raw[takaKey] ?? "").trim();
      if (poishaCell !== "" && takaCell !== "") {
        errors.push({
          row: rowNo,
          field: poishaKey,
          message: `Both ${poishaKey} and ${takaKey} are set — use only one money unit per row`,
        });
        return null;
      }
      if (takaCell !== "") {
        if (takaCell.startsWith("-")) {
          errors.push({ row: rowNo, field: takaKey, message: "Must not be negative" });
          return null;
        }
        const converted = takaStringToPoisha(takaCell);
        if (converted === undefined) {
          errors.push({ row: rowNo, field: takaKey, message: "Must be a valid taka amount (e.g. 1250 or 1250.50)" });
          return null;
        }
        return converted;
      }
      if (poishaCell !== "") {
        const parsedInt = toIntOrNull(poishaCell);
        if (parsedInt === undefined || parsedInt === null) {
          errors.push({ row: rowNo, field: poishaKey, message: "Must be an integer (poisha)" });
          return null;
        }
        if (parsedInt < 0) {
          errors.push({ row: rowNo, field: poishaKey, message: "Must not be negative" });
          return null;
        }
        return parsedInt;
      }
      return null;
    };
    const price = resolveMoney("price_poisha", "price_taka");
    if (price === null && !errors.some((e) => e.field === "price_poisha" || e.field === "price_taka")) {
      errors.push({ row: rowNo, field: "price_poisha / price_taka", message: "Price is required (price_poisha or price_taka)" });
    }
    const compareAt = resolveMoney("compare_at_poisha", "compare_at_taka");
    const cost = resolveMoney("cost_poisha", "cost_taka");
    const stock = toIntOrNull(raw.stock ?? "");
    if (stock === undefined) errors.push({ row: rowNo, field: "stock", message: "Must be an integer" });
    const parsed = rowSchema.safeParse({
      ...raw,
      // price === null always comes with an explicit error above
      // (conflict / invalid / negative / missing), so 0 is a safe
      // placeholder that avoids a duplicate generic zod complaint.
      price_poisha: price ?? 0,
      compare_at_poisha: compareAt,
      cost_poisha: cost,
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
  return { totalRows: rows.length, validRows, invalidRows, errorReportCsv: buildErrorReportCsv(invalidRows), moneyUnits };
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
