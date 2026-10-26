/**
 * PDF font embedding — ADV-29 (doc 22).
 *
 * The generated PDFs embed Hind Siliguri (the storefront's own brand
 * font, converted from the WOFF2 subsets bundled in this repo — see
 * fonts-data.ts for provenance) so Bengali text renders with real
 * Bengali glyphs and the ৳ sign, in every deployment target, with no
 * runtime file reads.
 *
 * SHAPING (verified, not assumed): pdf-lib delegates text encoding
 * and measurement to fontkit, whose layout engine DOES apply
 * OpenType shaping for Bengali — GSUB conjunct formation and
 * vowel-sign reordering included. Verified by glyph count in the
 * wave-43 smoke: "ক্ট" (3 codepoints) encodes as ONE ligature
 * glyph and "নিশ্চিত" as 5 shaped glyphs. fontkit's Indic shaper
 * is not HarfBuzz, so exotic clusters may differ in edge cases,
 * but standard conjuncts and ি/ে reordering render correctly.
 * (An earlier draft of this file claimed no shaping — that was
 * wrong; the glyph-count test is the evidence.)
 *
 * Fallback: if embedding ever fails, Helvetica is used and Bangla
 * characters are stripped by the writer's safeText (WinAnsi cannot
 * encode them) — English/numbers still render correctly, and the
 * caller is told via `bengaliEmbedded: false`.
 */
// @pdf-lib/fontkit's UMD build references a global
// `regeneratorRuntime` (its Indic shaper is transpiled async code);
// without this side-effect import, width measurement throws
// "regeneratorRuntime is not defined" in Node runtimes. It must be
// imported BEFORE fontkit.
import "regenerator-runtime/runtime";
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { HIND_SILIGURI_BOLD_BASE64, HIND_SILIGURI_REGULAR_BASE64 } from "./fonts-data";

export interface PdfFonts {
  regular: PDFFont;
  bold: PDFFont;
  /** false = Helvetica fallback; Bangla strings must be stripped. */
  bengaliEmbedded: boolean;
}

function decodeBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export async function embedPdfFonts(doc: PDFDocument): Promise<PdfFonts> {
  try {
    doc.registerFontkit(fontkit);
    const regular = await doc.embedFont(decodeBase64(HIND_SILIGURI_REGULAR_BASE64), { subset: true });
    const bold = await doc.embedFont(decodeBase64(HIND_SILIGURI_BOLD_BASE64), { subset: true });
    return { regular, bold, bengaliEmbedded: true };
  } catch {
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    return { regular, bold, bengaliEmbedded: false };
  }
}
