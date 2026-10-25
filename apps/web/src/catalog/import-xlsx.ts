// XLSX import — spreadsheet twin of the CSV pipeline (import.ts).
// Reads the FIRST sheet of an .xlsx workbook with SheetJS and turns it
// into the same { headers, rows } string table parseCsv produces; from
// there the shared previewImportRows() applies the identical column
// mapping and validation — poisha columns, *_taka columns with exact
// decimal-string conversion, per-row conflict rules, moneyUnits
// reporting. There is deliberately NO second validation path for
// spreadsheets, so XLSX and CSV can never drift apart.
//
// Server-side only: the SheetJS bundle is imported here, and only the
// import API routes import this module.
//
// File-level failures (corrupt workbook, no sheets, empty sheet, no
// header row) return Bangla messages the admin sees as-is — the file is
// rejected before any row validation, never half-parsed silently.
import * as XLSX from "xlsx";
import { previewImportRows, type ImportPreview } from "./import";

export interface ImportTable {
  headers: string[];
  rows: Record<string, string>[];
}

export type XlsxTableResult =
  | { ok: true; table: ImportTable; sheetName: string }
  | { ok: false; message: string };

export type XlsxPreviewResult =
  | { ok: true; preview: ImportPreview; sheetName: string }
  | { ok: false; message: string };

/** One worksheet cell -> the string form the shared pipeline expects.
 *  Mirrors parseCsv's text semantics: every cell ends up a trimmed
 *  string; numbers keep their plain decimal spelling (1250.5 stays
 *  "1250.5", so the taka conversion downstream stays exact). */
function cellToString(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "string") return cell.trim();
  if (typeof cell === "number") return Number.isFinite(cell) ? String(cell) : "";
  if (typeof cell === "boolean") return cell ? "true" : "false";
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return "";
}

/**
 * Parse an .xlsx workbook (raw bytes) into the shared import table.
 * Only the first sheet is read — the admin page states this plainly.
 * Header names are trimmed + lowercased exactly like the CSV parser,
 * and fully-empty rows are dropped (parseCsv drops empty lines the
 * same way).
 */
export function parseXlsxTable(data: Uint8Array): XlsxTableResult {
  // An .xlsx file is an OOXML ZIP archive — check the PK\x03\x04
  // magic first. Without this, SheetJS happily "parses" any renamed
  // text file as delimited text and the merchant gets garbage headers
  // instead of an honest "not a spreadsheet" error. (An old binary
  // .xls also lands here — it is not an .xlsx, and the message says
  // exactly that.)
  const isZip =
    data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
  if (!isZip) {
    return {
      ok: false,
      message: "ফাইলটি একটি বৈধ .xlsx (Excel) ফাইল নয় — ফাইলটি নষ্ট হয়ে গেছে, অথবা অন্য ফরম্যাটের ফাইলের নাম বদলে .xlsx করা হয়েছে।",
    };
  }
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: "array" });
  } catch {
    return {
      ok: false,
      message: "ফাইলটি পড়া যায়নি — এটি একটি বৈধ .xlsx ফাইল নয়, অথবা ফাইলটি নষ্ট (corrupt) হয়ে গেছে।",
    };
  }
  const sheetName = workbook.SheetNames[0];
  if (sheetName === undefined) {
    return { ok: false, message: "ওয়ার্কবুকে কোনো শিট পাওয়া যায়নি।" };
  }
  const sheet = workbook.Sheets[sheetName];
  if (sheet === undefined) {
    return { ok: false, message: "ওয়ার্কবুকের প্রথম শিটটি পড়া যায়নি।" };
  }
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });
  const nonEmpty = matrix.filter(
    (row) => Array.isArray(row) && row.some((cell) => cellToString(cell) !== ""),
  );
  if (nonEmpty.length === 0) {
    return {
      ok: false,
      message: "প্রথম শিটটি একদম খালি — হেডার সারি ও অন্তত একটি ডেটা সারি থাকতে হবে।",
    };
  }
  const headerRow = nonEmpty[0] as unknown[];
  const headers = headerRow.map((cell) => cellToString(cell).toLowerCase());
  if (headers.every((h) => h === "")) {
    return {
      ok: false,
      message: "প্রথম সারিতে কোনো কলামের নাম (হেডার) পাওয়া যায়নি — প্রথম সারিতে slug, title_bn, sku ইত্যাদি কলামের নাম থাকতে হবে।",
    };
  }
  const rows: Record<string, string>[] = nonEmpty.slice(1).map((cols) => {
    const cells = cols as unknown[];
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = cellToString(cells[idx]);
    });
    return obj;
  });
  return { ok: true, table: { headers, rows }, sheetName };
}

/** Preview an .xlsx upload through the shared CSV row pipeline. */
export function previewXlsxImport(data: Uint8Array, existingSkus: Set<string>): XlsxPreviewResult {
  const parsed = parseXlsxTable(data);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    preview: previewImportRows(parsed.table.headers, parsed.table.rows, existingSkus),
    sheetName: parsed.sheetName,
  };
}
