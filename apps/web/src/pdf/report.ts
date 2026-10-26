/**
 * Custom-report PDF renderer — ADV-29 (doc 22).
 *
 * Renders a BuiltReport from src/reports/builder.ts — the SAME
 * definition + rows the watermarked CSV export produces, so the
 * PDF and the CSV can never disagree: the table shows the first
 * 200 rows (labelled when truncated) and the totals row sums ALL
 * rows of the report. Every page carries the export watermark
 * ("Generated from <store> admin" + generated-at + exported-by +
 * reason), mirroring the CSV watermark header's facts.
 */
import { PDFDocument } from "pdf-lib";
import { embedPdfFonts } from "./fonts";
import { A4_LANDSCAPE, BORDER, BRAND, INK, MUTED, PdfWriter } from "./text";
import { formatBdt } from "@/checkout/pricing";
import type { BuiltReport } from "@/reports/builder";

const MARGIN = 36;
const MAX_TABLE_ROWS = 200;

export interface ReportPdfMeta {
  /** Store name from Settings; falls back to the platform name. */
  storeName: string;
  exportedBy: string;
  reason: string;
  generatedAt: Date;
  rangeLabel: string;
}

function dhakaTimestamp(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export async function renderReportPdf(built: BuiltReport, meta: ReportPdfMeta): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = await embedPdfFonts(doc);
  const store = meta.storeName.trim() !== "" ? meta.storeName.trim() : "Advance Ecommerce";
  const generated = dhakaTimestamp(meta.generatedAt);
  const w = new PdfWriter(
    doc,
    fonts,
    A4_LANDSCAPE,
    MARGIN,
    `Generated from ${store} admin · ${generated} (Asia/Dhaka)`,
  );

  w.text(`${store} — কাস্টম রিপোর্ট / Custom report (${built.dataset})`, 0, w.contentWidth, { size: 14, bold: true });
  w.text(`পরিসর / Range: ${meta.rangeLabel} (Asia/Dhaka days)`, 0, w.contentWidth, { size: 9.5, color: MUTED });
  w.text(
    `Generated from ${store} admin · generated-at: ${generated} (Asia/Dhaka) · exported-by: ${meta.exportedBy} · reason: ${meta.reason}`,
    0,
    w.contentWidth,
    { size: 8.5, color: MUTED },
  );
  const totalRows = built.rows.length;
  const shown = Math.min(totalRows, MAX_TABLE_ROWS);
  if (totalRows > MAX_TABLE_ROWS) {
    w.text(
      `প্রথম ${MAX_TABLE_ROWS}টি সারি দেখানো হচ্ছে — মোট সারি ${totalRows}টি; নিচের মোট হিসাব সব সারির উপর। / Showing the first ${MAX_TABLE_ROWS} of ${totalRows} rows; totals below cover ALL rows.`,
      0,
      w.contentWidth,
      { size: 8.5, color: BRAND },
    );
  }
  w.gap(4);

  // Column widths by type: text widest, money next, int narrowest.
  const weightOf = (t: string) => (t === "text" ? 2.2 : t === "money" ? 1.5 : 0.9);
  const totalWeight = built.columns.reduce((s, c) => s + weightOf(c.type), 0);
  const widths = built.columns.map((c) => Math.max(46, (weightOf(c.type) / totalWeight) * w.contentWidth));
  const xs: number[] = [];
  {
    let acc = 0;
    for (const width of widths) {
      xs.push(acc);
      acc += width;
    }
  }
  const cellText = (value: string | number | undefined, type: string): string => {
    if (value === undefined || value === null || value === "") return "—";
    if (type === "money") return formatBdt(Number(value));
    return String(value);
  };
  const numeric = (type: string) => type !== "text";

  const header = () => {
    w.band(15);
    w.y += 3;
    built.columns.forEach((c, i) => {
      w.text(w.truncate(c.label, 7.5, widths[i] - 4, true), xs[i], widths[i] - 4, {
        size: 7.5,
        bold: true,
        align: numeric(c.type) ? "right" : "left",
        advance: false,
      });
    });
    w.y += 12;
  };
  header();

  const rowHeight = 12.5;
  for (const row of built.rows.slice(0, shown)) {
    w.ensureSpace(rowHeight + rowHeight + 6);
    if (w.y === MARGIN) header();
    built.columns.forEach((c, i) => {
      const value = cellText(row[c.key], c.type);
      w.text(w.truncate(value, 7.5, widths[i] - 4), xs[i], widths[i] - 4, {
        size: 7.5,
        align: numeric(c.type) ? "right" : "left",
        advance: false,
      });
    });
    w.y += rowHeight;
  }

  // Totals over ALL rows (identical sums to the CSV's rows).
  w.ensureSpace(30);
  w.gap(2);
  w.hline(BORDER, 1);
  built.columns.forEach((c, i) => {
    if (i === 0) {
      w.text(`মোট / Total (${totalRows} rows)`, xs[i], widths[i] - 4, { size: 8, bold: true, advance: false });
      return;
    }
    if (c.type === "int" || c.type === "money") {
      const sum = built.rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
      w.text(cellText(sum, c.type), xs[i], widths[i] - 4, { size: 8, bold: true, align: "right", advance: false });
    }
  });
  w.y += 14;

  w.finish();
  return doc.save();
}
