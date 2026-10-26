/**
 * Invoice PDF renderer — ADV-29 (doc 22).
 *
 * Renders src/pdf/invoice-data.ts (the screens' own read models) as
 * a clean A4 document: store masthead, order meta, billed-to block,
 * item table with page-break header repetition, and the money block
 * (subtotal → discount → delivery → residual → [gift card] → total
 * → paid → due) exactly as computeInvoiceMoneyRows built it.
 * Bengali renders through the embedded Hind Siliguri font with
 * fontkit shaping — see src/pdf/fonts.ts.
 */
import { PDFDocument } from "pdf-lib";
import { embedPdfFonts } from "./fonts";
import { A4_PORTRAIT, BORDER, BRAND, INK, MUTED, PdfWriter } from "./text";
import { formatBdt, type InvoiceData } from "./invoice-data";
import { DEFAULT_INVOICE_FOOTER, invoiceSlotText } from "@/templates/overrides";

const MARGIN = 48;
// Item table columns (content width = 499.28pt).
const COL = { name: 0, sku: 252, qty: 344, unit: 388, amount: 452 };
const COLW = { name: 244, sku: 88, qty: 40, unit: 60, amount: 47 };

export async function renderInvoicePdf(data: InvoiceData, generatedAt: Date): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = await embedPdfFonts(doc);
  const generatedLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(generatedAt);
  const footerStore = data.storeName !== "" ? data.storeName : "Advance Ecommerce";
  const w = new PdfWriter(
    doc,
    fonts,
    A4_PORTRAIT,
    MARGIN,
    `${footerStore} · Invoice generated ${generatedLabel} (Asia/Dhaka)`,
  );

  // Masthead: store name left, INVOICE right.
  const title = data.storeName !== "" ? data.storeName : "ইনভয়েস";
  w.text(title, 0, 340, { size: 19, bold: true, advance: false });
  w.text("ইনভয়েস / INVOICE", 340, w.contentWidth - 340, { size: 15, bold: true, color: BRAND, align: "right" });
  if (data.storeAddress !== "") {
    w.block(data.storeAddress, 0, 340, { size: 9, color: MUTED });
  }
  if (data.storeBin !== "") {
    w.text(`BIN: ${data.storeBin}`, 0, 340, { size: 9, color: MUTED });
  }
  w.gap(2);
  w.hline(BRAND, 1.4);

  // Merchant header note (ADV-29 template override) — unset prints
  // nothing, exactly as before overrides existed.
  if (data.headerNote !== null && data.headerNote !== "") {
    w.gap(2);
    w.block(data.headerNote, 0, w.contentWidth, { size: 9, color: MUTED });
  }

  // Meta: order no + date left; status + payment right.
  w.text(`অর্ডার / Order: ${data.orderNo}`, 0, 300, { size: 12, bold: true, advance: false });
  w.text(`অবস্থা / Status: ${data.status}`, 300, w.contentWidth - 300, { size: 10, align: "right" });
  w.text(`তারিখ / Date: ${data.createdAtLabel} (Asia/Dhaka)`, 0, 300, { size: 10, color: MUTED, advance: false });
  w.text(`পেমেন্ট / Payment: ${data.paymentMethodLabel} · ${data.paymentStatus}`, 300, w.contentWidth - 300, {
    size: 10,
    color: MUTED,
    align: "right",
  });
  w.gap(8);

  // Billed to.
  w.text("বিল প্রাপক / BILLED TO", 0, w.contentWidth, { size: 8.5, bold: true, color: MUTED });
  w.text(data.customerName, 0, w.contentWidth, { size: 12, bold: true });
  w.text(data.customerPhone, 0, w.contentWidth, { size: 10, color: MUTED });
  w.block(data.addressText, 0, 430, { size: 10 });
  if (data.giftMessage !== null && data.giftMessage !== "") {
    w.block(`উপহারের বার্তা / Gift message: ${data.giftMessage}`, 0, 430, { size: 9.5, color: MUTED });
  }
  w.gap(8);

  // Items table.
  const header = () => {
    w.band(17);
    w.y += 3.5;
    w.text("পণ্য / Item", COL.name, COLW.name, { size: 8.5, bold: true, advance: false });
    w.text("SKU", COL.sku, COLW.sku, { size: 8.5, bold: true, advance: false });
    w.text("পরিমাণ", COL.qty, COLW.qty, { size: 8.5, bold: true, align: "right", advance: false });
    w.text("একক দাম", COL.unit, COLW.unit, { size: 8.5, bold: true, align: "right", advance: false });
    w.text("মোট", COL.amount, COLW.amount, { size: 8.5, bold: true, align: "right" });
    w.y += 2;
  };
  header();
  for (const item of data.items) {
    const nameLines = w.wrap(item.productName, 9.5, COLW.name).slice(0, 3);
    const rowHeight = Math.max(15, nameLines.length * 13 + 3);
    w.ensureSpace(rowHeight + 2);
    if (w.y === MARGIN) header(); // page broke before this row
    const rowTop = w.y;
    nameLines.forEach((line, i) => {
      w.text(line, COL.name, COLW.name, { size: 9.5, advance: i < nameLines.length - 1, lineHeight: 13 });
    });
    w.y = rowTop;
    w.text(w.truncate(item.sku, 8.5, COLW.sku, false), COL.sku, COLW.sku, { size: 8.5, color: MUTED, advance: false });
    w.text(String(item.quantity), COL.qty, COLW.qty, { size: 9.5, align: "right", advance: false });
    w.text(formatBdt(item.unitPricePoisha), COL.unit, COLW.unit, { size: 9.5, align: "right", advance: false });
    w.text(formatBdt(item.lineTotalPoisha), COL.amount, COLW.amount, { size: 9.5, bold: true, align: "right" });
    w.y = Math.max(w.y, rowTop + rowHeight);
  }
  w.gap(4);
  w.hline();

  // Money block (right-hand column).
  const moneyX = 219;
  const moneyW = w.contentWidth - moneyX;
  w.ensureSpace(data.moneyRows.length * 15 + 12);
  for (const row of data.moneyRows) {
    const emphasized = row.emphasis !== undefined;
    if (emphasized) w.hline(BORDER, 0.7);
    w.text(`${row.labelBn} / ${row.labelEn}`, moneyX, moneyW - 110, {
      size: emphasized ? 10.5 : 9.5,
      bold: emphasized,
      color: row.emphasis === "due" ? BRAND : INK,
      advance: false,
      lineHeight: 15,
    });
    const amount = row.poisha < 0 ? `−${formatBdt(-row.poisha)}` : formatBdt(row.poisha);
    w.text(amount, moneyX + moneyW - 110, 110, {
      size: emphasized ? 10.5 : 9.5,
      bold: emphasized,
      align: "right",
      lineHeight: 15,
    });
  }

  w.gap(14);
  // Merchant terms line (ADV-29 template override) — unset prints
  // nothing.
  if (data.termsLine !== null && data.termsLine !== "") {
    w.block(data.termsLine, 0, w.contentWidth, { size: 8.5, color: MUTED });
    w.gap(2);
  }
  // Footer note: the merchant override when set, otherwise the
  // built-in copy this renderer always printed (DEFAULT_INVOICE_FOOTER
  // in src/templates/overrides.ts — the same text, so an unconfigured
  // shop's invoice is unchanged).
  w.block(
    data.footerNote ?? invoiceSlotText(DEFAULT_INVOICE_FOOTER) ?? "",
    0,
    w.contentWidth,
    { size: 8.5, color: MUTED },
  );

  w.finish();
  return doc.save();
}
