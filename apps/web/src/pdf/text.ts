/**
 * Minimal PDF layout writer over pdf-lib — ADV-29 (doc 22).
 *
 * A top-down cursor (points from the top edge) so renderers read
 * like the documents they produce. Handles word wrap (with a
 * char-split fallback for overlong words), right/center alignment,
 * page breaks with a reserved footer band, and a final pass that
 * stamps "Page i of n" + a footer line on every page.
 */
import { rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import type { PdfFonts } from "./fonts";

export const INK = rgb(0.13, 0.14, 0.17);
export const MUTED = rgb(0.44, 0.46, 0.52);
export const BORDER = rgb(0.84, 0.85, 0.88);
export const SHADE = rgb(0.955, 0.955, 0.97);
export const BRAND = rgb(0.31, 0.27, 0.85);

export const A4_PORTRAIT = { width: 595.28, height: 841.89 };
export const A4_LANDSCAPE = { width: 841.89, height: 595.28 };

const FOOTER_RESERVE = 26;

export interface TextOptions {
  size?: number;
  bold?: boolean;
  color?: ReturnType<typeof rgb>;
  align?: "left" | "right" | "center";
  /** Advance the cursor after drawing (default true). */
  advance?: boolean;
  lineHeight?: number;
}

export class PdfWriter {
  readonly pages: PDFPage[] = [];
  /** Cursor: points from the TOP edge of the current page. */
  y = 0;

  constructor(
    private readonly doc: PDFDocument,
    readonly fonts: PdfFonts,
    private readonly pageSize: { width: number; height: number },
    readonly margin: number,
    private readonly footerText: string,
  ) {
    this.newPage();
  }

  get page(): PDFPage {
    return this.pages[this.pages.length - 1];
  }

  get contentWidth(): number {
    return this.pageSize.width - this.margin * 2;
  }

  get rightEdge(): number {
    return this.pageSize.width - this.margin;
  }

  newPage(): void {
    const page = this.doc.addPage([this.pageSize.width, this.pageSize.height]);
    this.pages.push(page);
    this.y = this.margin;
  }

  /** Make text safe for the active font: collapse whitespace, and —
   *  only in the Helvetica fallback — drop characters WinAnsi
   *  cannot encode (Bangla), keeping English/numbers exact. */
  safeText(text: string): string {
    const flat = text.replace(/\s+/g, " ").trim();
    if (this.fonts.bengaliEmbedded) return flat;
    return flat.replace(/[^\x20-\xFF]/g, "");
  }

  font(bold: boolean): PDFFont {
    return bold ? this.fonts.bold : this.fonts.regular;
  }

  width(text: string, size: number, bold = false): number {
    return this.font(bold).widthOfTextAtSize(this.safeText(text), size);
  }

  /** Word-wrap to a max width; overlong words are char-split. */
  wrap(text: string, size: number, maxWidth: number, bold = false): string[] {
    const clean = this.safeText(text);
    if (clean === "") return [""];
    const words = clean.split(" ");
    const lines: string[] = [];
    let current = "";
    const pushWord = (word: string) => {
      let rest = word;
      while (this.width(rest, size, bold) > maxWidth && rest.length > 1) {
        let cut = rest.length;
        while (cut > 1 && this.width(rest.slice(0, cut), size, bold) > maxWidth) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      current = rest;
    };
    for (const word of words) {
      if (current === "") {
        pushWord(word);
      } else if (this.width(`${current} ${word}`, size, bold) <= maxWidth) {
        current = `${current} ${word}`;
      } else {
        lines.push(current);
        current = "";
        pushWord(word);
      }
    }
    if (current !== "") lines.push(current);
    return lines.length > 0 ? lines : [""];
  }

  /** Truncate to one line with an ellipsis when too wide. */
  truncate(text: string, size: number, maxWidth: number, bold = false): string {
    const clean = this.safeText(text);
    if (this.width(clean, size, bold) <= maxWidth) return clean;
    let out = clean;
    while (out.length > 1 && this.width(`${out}…`, size, bold) > maxWidth) out = out.slice(0, -1);
    return `${out}…`;
  }

  private baseline(size: number): number {
    return this.pageSize.height - this.y - size;
  }

  /** Draw one line at the cursor. x is relative to the left margin
   *  (align right/center resolve against maxWidth from x). */
  text(text: string, x: number, maxWidth: number, opts: TextOptions = {}): void {
    const size = opts.size ?? 10;
    const bold = opts.bold ?? false;
    const value = this.safeText(text);
    const w = this.font(bold).widthOfTextAtSize(value, size);
    let drawX = this.margin + x;
    if (opts.align === "right") drawX = this.margin + x + maxWidth - w;
    if (opts.align === "center") drawX = this.margin + x + (maxWidth - w) / 2;
    this.page.drawText(value, {
      x: drawX,
      y: this.baseline(size),
      size,
      font: this.font(bold),
      color: opts.color ?? INK,
    });
    if (opts.advance !== false) this.y += opts.lineHeight ?? size * 1.45;
  }

  /** Draw a wrapped block; returns nothing, cursor ends below it. */
  block(text: string, x: number, maxWidth: number, opts: TextOptions = {}): void {
    const size = opts.size ?? 10;
    const lines = this.wrap(text, size, maxWidth, opts.bold ?? false);
    for (const line of lines) {
      this.text(line, x, maxWidth, { ...opts, advance: true });
    }
  }

  gap(points: number): void {
    this.y += points;
  }

  hline(color: ReturnType<typeof rgb> = BORDER, thickness = 0.7): void {
    this.page.drawRectangle({
      x: this.margin,
      y: this.pageSize.height - this.y - thickness,
      width: this.contentWidth,
      height: thickness,
      color,
    });
    this.y += thickness + 4;
  }

  /** Filled band at the cursor (table headers). */
  band(height: number, color: ReturnType<typeof rgb> = SHADE): void {
    this.page.drawRectangle({
      x: this.margin,
      y: this.pageSize.height - this.y - height,
      width: this.contentWidth,
      height,
      color,
    });
  }

  ensureSpace(height: number): void {
    if (this.y + height > this.pageSize.height - this.margin - FOOTER_RESERVE) {
      this.newPage();
    }
  }

  /** Stamp footer text (left) + "Page i of n" (right) on all pages. */
  finish(): void {
    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      const footer = this.safeText(this.footerText);
      page.drawText(footer, {
        x: this.margin,
        y: 24,
        size: 7.5,
        font: this.fonts.regular,
        color: MUTED,
      });
      const label = `Page ${i + 1} of ${total}`;
      const w = this.fonts.regular.widthOfTextAtSize(label, 7.5);
      page.drawText(label, {
        x: this.pageSize.width - this.margin - w,
        y: 24,
        size: 7.5,
        font: this.fonts.regular,
        color: MUTED,
      });
    });
  }
}
