/**
 * Print-on-demand selection — ADV-23 vertical 5 (doc 23, wave 56).
 *
 * PURE module (zod + types + string math only, no prisma / settings
 * imports) so the checkout form schema can embed the selection
 * shape client-side, exactly like the restaurant / services /
 * rental selections. The server-side config + persistence live in
 * src/pod/config.ts and src/pod/customisation.ts.
 *
 * A POD line carries a CUSTOMISATION, not a booking:
 *   pod: { variantId, printText, printColor? }
 * The customer types the text that will be printed on the item
 * (a name on a mug, a slogan on a tee) and optionally picks a print
 * colour from the merchant's palette. The selection is validated
 * AGAIN server-side against the stored config at create time
 * (validatePodSelection) — the client's view is never trusted,
 * mirroring the other verticals' contract.
 *
 * There is NO schema for this vertical (deliberately): the
 * customisation is FROZEN onto the order as an OrderNote — a
 * human-readable line the print shop works from, plus a machine
 * line `[pod:{...json}]` the admin order GET and the print queue
 * parse back (the house OrderNote-marker convention: `[pickup:<id>]`,
 * `[box:<cycleKey>]`, `[rx-record]`). The print FEE is the one money
 * touch: pod.config printFeePoisha is a PER-ITEM fee, and the total
 * (fee × the POD line's quantity, the single line-level rounding
 * rule) enters the order through the checkout pricing pipeline as
 * the `printFeePoisha` line (src/checkout/pricing.ts), exactly
 * where the rental deposit line sits — its own visible breakdown
 * line, included in the grand total.
 *
 * v1 has NO image/artwork upload: customer artwork depends on
 * object storage (Settings storage.*), which is not configured
 * until the merchant adds R2/S3 credentials. pod.config carries
 * `allowImageUpload` (default FALSE) so the intent is stored, but
 * while storage is unconfigured no surface offers an upload at
 * all — text + colour is the whole customisation in v1.
 */
import { z } from "zod";
import { lineTotalPoisha } from "@/lib/quantity";

/** Hard shape cap on the submitted text (any config). The REAL cap
 *  is pod.config textMaxChars (default 20), enforced at the gate
 *  after sanitising; this bound only keeps absurd payloads out of
 *  the form schema. */
export const POD_TEXT_SHAPE_MAX = 500;

export const podSelectionSchema = z.object({
  variantId: z.string().min(1),
  /** The text to print. Raw here — the gate trims it and strips
   *  control characters, then enforces the config cap. */
  printText: z.string().max(POD_TEXT_SHAPE_MAX),
  /** A colour from the merchant's palette (pod.config colors),
   *  verbatim. Absent = the shop's default ink. */
  printColor: z.string().trim().min(1).max(64).optional(),
});

export type PodSelection = z.infer<typeof podSelectionSchema>;

/** Label of the print-fee line wherever a pricing breakdown
 *  renders (checkout confirmation, invoice, print centre). */
export const POD_PRINT_FEE_LABEL_BN = "প্রিন্ট ফি";
export const POD_PRINT_FEE_LABEL_EN = "Print fee";

/**
 * The merchant's POD config as the pure helpers need it
 * (src/pod/config.ts resolves the stored doc into this).
 * `podVariantIds` is the v1 "what is custom-printable" marker —
 * the services/rental precedent: the Product type enum has no POD
 * value, so custom-printable variants are an explicit
 * merchant-maintained list. Nothing is printable until the
 * merchant lists it. `allowImageUpload` is stored intent ONLY in
 * v1 (see the header): no upload endpoint exists until storage
 * credentials do, whatever this flag says.
 */
export interface EffectivePodConfig {
  podVariantIds: string[];
  printFeePoisha: number;
  textMaxChars: number;
  allowImageUpload: boolean;
  colors: string[];
}

/** The validated POD spec both create seams freeze onto the order
 *  note. `feePoisha` is the TOTAL print fee for the line
 *  (per-item fee × quantity, line-level rounding) — the figure
 *  the callers pass into the pricing pipeline. */
export interface PodSpec {
  variantId: string;
  /** Sanitised print text (trimmed, control chars stripped). */
  printText: string;
  /** Palette colour, verbatim; null = shop default. */
  printColor: string | null;
  /** Per-item print fee from the config at order time (poisha). */
  feePerItemPoisha: number;
  /** The POD line's quantity at order time (milli-exact number). */
  quantity: number;
  /** Total print fee charged with this order (poisha), frozen. */
  feePoisha: number;
}

/** The write spec is the display spec in v1 (the rental precedent)
 *  — the customisation persists as an order note, not a table row,
 *  so there is no transaction-time re-read to freeze for. */
export type PodWriteSpec = PodSpec;

/* ------------------------------------------------------------------ */
/* Text sanitising                                                     */
/* ------------------------------------------------------------------ */

/**
 * Make customer print text safe to freeze and to print: control
 * characters (incl. newlines, tabs, DEL) are REMOVED — a printed
 * line is one line — and the result is trimmed. Length is measured
 * in Unicode code points by the validator ([...text].length), so
 * a Bengali name counts its visible characters, not UTF-16 units.
 */
export function sanitizePrintText(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim();
}

export function printTextLength(text: string): number {
  return [...text].length;
}

/* ------------------------------------------------------------------ */
/* Selection validation (pure part)                                    */
/* ------------------------------------------------------------------ */

export type PodValidation =
  | { ok: true; spec: PodSpec }
  | { ok: false; code: string; message: string };

/**
 * Validate a submitted customisation against the effective config
 * and the order's own lines. Rules:
 *   - the variant must be on the merchant's podVariantIds list;
 *   - the variant must be among the order's items;
 *   - the sanitised text must be non-empty and within the config's
 *     textMaxChars (code points);
 *   - a submitted colour must be on the config palette (an empty
 *     palette accepts NO colour — the shop never promised one).
 * V1: ONE customised line per order (the selection names a single
 * variant); the fee is per item, so the line's quantity may be
 * any positive amount.
 */
export function validatePodSelection(
  selection: PodSelection,
  config: EffectivePodConfig,
  items: Array<{ variantId: string; quantity: number }>,
): PodValidation {
  if (!config.podVariantIds.includes(selection.variantId)) {
    return {
      ok: false,
      code: "POD_VARIANT_NOT_LISTED",
      message:
        "এই আইটেমটিতে কাস্টম প্রিন্টের সুবিধা নেই। / This item is not listed for custom printing.",
    };
  }
  const quantity = items
    .filter((i) => i.variantId === selection.variantId)
    .reduce((sum, i) => sum + i.quantity, 0);
  if (quantity <= 0) {
    return {
      ok: false,
      code: "POD_VARIANT_NOT_IN_ORDER",
      message:
        "কাস্টম প্রিন্টের আইটেমটি এই অর্ডারে নেই। / The custom-print item is not part of this order.",
    };
  }
  const printText = sanitizePrintText(selection.printText);
  if (printText === "") {
    return {
      ok: false,
      code: "POD_TEXT_REQUIRED",
      message: "ছাপানোর লেখাটি দিন। / Please enter the text to print.",
    };
  }
  if (printTextLength(printText) > config.textMaxChars) {
    return {
      ok: false,
      code: "POD_TEXT_TOO_LONG",
      message: `ছাপানোর লেখা সর্বোচ্চ ${config.textMaxChars} অক্ষরের হতে পারবে। / The print text can be at most ${config.textMaxChars} characters.`,
    };
  }
  const printColor = selection.printColor?.trim() ? selection.printColor.trim() : null;
  if (printColor !== null && !config.colors.includes(printColor)) {
    return {
      ok: false,
      code: "POD_COLOR_UNKNOWN",
      message:
        "বেছে নেওয়া রঙটি এই দোকানের তালিকায় নেই। / The chosen colour is not in this shop's palette.",
    };
  }
  return {
    ok: true,
    spec: {
      variantId: selection.variantId,
      printText,
      printColor,
      feePerItemPoisha: Math.max(0, config.printFeePoisha),
      quantity,
      feePoisha: lineTotalPoisha(Math.max(0, config.printFeePoisha), quantity),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Order-note freeze (write + parse)                                   */
/* ------------------------------------------------------------------ */

/** Machine-line prefix on the create-time order note. The payload
 *  is JSON on its OWN line, so parsing never depends on the
 *  customer's text: control chars (incl. newlines) were stripped
 *  before freezing, so the JSON can never break its line. The
 *  `[pod-printed]` attestation is a separate, later note. */
export const POD_NOTE_MARKER_PREFIX = "[pod:";
export const POD_PRINTED_MARKER = "[pod-printed]";

/** The note line staff append when the item has been printed —
 *  its presence (not a status column) is what removes the order
 *  from the print queue. */
export const POD_PRINTED_NOTE_TEXT =
  "[pod-printed] প্রিন্ট সম্পন্ন — কাস্টম প্রিন্ট ছাপানো শেষ হয়েছে। / Printed — the custom print is done.";

/** The frozen payload parsed back out of a note (the admin order
 *  GET's data.pod projection + the print queue row). */
export interface PodNotePayload {
  variantId: string;
  productName: string | null;
  printText: string;
  printColor: string | null;
  feePerItemPoisha: number;
  quantity: number;
  feePoisha: number;
}

/**
 * The create-time order-note text both create seams record for a
 * POD order (the pickup/rental note precedent): a human line the
 * print shop reads and works from, then the machine line the
 * projections parse. The fee restated on the note is the SAME
 * frozen figure the pricing pipeline charged (spec.feePoisha).
 */
export function podOrderNoteText(spec: PodSpec, productName: string): string {
  const payload: PodNotePayload = {
    variantId: spec.variantId,
    productName,
    printText: spec.printText,
    printColor: spec.printColor,
    feePerItemPoisha: spec.feePerItemPoisha,
    quantity: spec.quantity,
    feePoisha: spec.feePoisha,
  };
  const colorPart = spec.printColor ? ` · রঙ / colour: ${spec.printColor}` : "";
  const feePart =
    spec.feePoisha > 0
      ? ` · প্রিন্ট ফি ${spec.feePoisha} পয়সা অর্ডারের মোট মূল্যে অন্তর্ভুক্ত / print fee of ${spec.feePoisha} poisha included in the order total`
      : "";
  const human =
    `কাস্টম প্রিন্ট: «${spec.printText}»${colorPart} — ${productName} (×${spec.quantity})${feePart}।` +
    ` / Custom print: "${spec.printText}"${spec.printColor ? `, colour: ${spec.printColor}` : ""} — ${productName} (x${spec.quantity}).`;
  return `${human}\n${POD_NOTE_MARKER_PREFIX}${JSON.stringify(payload)}]`;
}

/** Parse the frozen payload out of ONE note's text (the machine
 *  line only — a human line merely mentioning prints never
 *  parses). Returns null when the note carries no POD payload or
 *  the payload is malformed. */
export function podSpecFromNoteText(text: string): PodNotePayload | null {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(POD_NOTE_MARKER_PREFIX) || !trimmed.endsWith("]")) continue;
    try {
      const parsed = JSON.parse(
        trimmed.slice(POD_NOTE_MARKER_PREFIX.length, -1),
      ) as Partial<PodNotePayload>;
      if (
        typeof parsed.variantId === "string" &&
        typeof parsed.printText === "string" &&
        typeof parsed.feePoisha === "number"
      ) {
        return {
          variantId: parsed.variantId,
          productName: typeof parsed.productName === "string" ? parsed.productName : null,
          printText: parsed.printText,
          printColor: typeof parsed.printColor === "string" ? parsed.printColor : null,
          feePerItemPoisha:
            typeof parsed.feePerItemPoisha === "number" ? parsed.feePerItemPoisha : 0,
          quantity: typeof parsed.quantity === "number" ? parsed.quantity : 1,
          feePoisha: parsed.feePoisha,
        };
      }
    } catch {
      // Malformed machine line — not a POD note we can trust.
    }
  }
  return null;
}
