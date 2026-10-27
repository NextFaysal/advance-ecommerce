/**
 * POS register logic — pure. Agent 14.
 *
 * Rules:
 * - The module.pos flag gates everything (assertPosEnabled) — a locked POS
 *   never opens a shift.
 * - A register has at most ONE open shift (enforced by the caller/store via
 *   openShiftForRegister; this module provides the check).
 * - Sale total = sum(lines) - discount. Discount can never exceed the line
 *   subtotal (total can reach 0, never negative).
 * - CASH change = tendered - total, and tendered < total is an error, never
 *   a partial sale. Non-cash sales ignore tendered.
 * - Shift close: expected = float + CASH sales (synced or queued) - 0 refunds
 *   in this slice. Variance = counted - expected is REPORTED, and a non-zero
 *   variance with no note is rejected — shortages are explained, not buried.
 * - Receipt data reuses src/orders/print buildPrintData via a synthetic
 *   order shape, so POS receipts and order invoices print identically.
 *   The receipt carries the sale's REAL payment method (D3 fix): each
 *   PosPaymentMethod maps to its own PaymentMethod key + label — a NAGAD
 *   or CARD sale no longer prints as bkash — and a discounted sale gets
 *   an explicit discount line so line amounts − discount = total.
 */
import { formatBdt } from "../checkout/pricing";
import { FALLBACK_LOCALE, interpolate, pick, type Locale } from "../i18n/locale";
import { buildPrintData, type PrintFormat } from "../orders/print";
import type { Order, PaymentMethod } from "../orders/types";
import { isPosEnabled, type PosFlagStore } from "./flags";
import type {
  CreatePosSaleInput,
  PosPaymentMethod,
  PosReceiptData,
  PosSale,
  PosShift,
  ScanPayload,
  ScanResolution,
} from "./types";

/**
 * Doc 30: every human-facing string this module produces — receipt
 * copy and error messages — is a bn/en pair, picked by the caller's
 * locale. Error CODES and result shapes never localize. Callers that
 * resolve a locale (POS client, sale/shift routes) thread it in; the
 * default is the project fallback locale.
 */
const bn = {
  moduleLocked: "POS মডিউলটি এই ইনস্টলে বন্ধ আছে (module.pos ফ্ল্যাগ OFF)।",
  discountExceedsSubtotal: "ছাড় বিক্রির মোটের বেশি হতে পারবে না।",
  tenderedShort: "প্রদত্ত নগদ বিক্রির মোটের চেয়ে কম।",
  cashRequiresTendered: "CASH বিক্রিতে tenderedPoisha দিতে হবে।",
  shiftAlreadyClosed: "শিফটটি ইতিমধ্যে {status}।",
  varianceNoteRequired: "শিফট বন্ধে নগদের অমিল থাকলে নোটে ঘাটতি/বেশির কারণ লিখতে হবে।",
  walkInCustomer: "ওয়াক-ইন গ্রাহক",
  discountLine: "ছাড় (Discount)",
  payCash: "ক্যাশ (Cash)",
  payBkash: "বিকাশ (bKash)",
  payNagad: "নগদ (Nagad)",
  payCard: "কার্ড (Card)",
};
type PosRegisterStrings = typeof bn;
const en: { [K in keyof PosRegisterStrings]: string } = {
  moduleLocked: "POS module is locked for this install (module.pos flag is OFF).",
  discountExceedsSubtotal: "Discount cannot exceed the sale subtotal.",
  tenderedShort: "Tendered cash is less than the sale total.",
  cashRequiresTendered: "CASH sale requires tenderedPoisha.",
  shiftAlreadyClosed: "Shift is already {status}.",
  varianceNoteRequired: "Cash variance at close requires a note (shortage/overage must be explained).",
  walkInCustomer: "Walk-in Customer",
  discountLine: "Discount",
  payCash: "Cash",
  payBkash: "bKash",
  payNagad: "Nagad",
  payCard: "Card",
};
const STRINGS: Record<Locale, PosRegisterStrings> = { bn, en };

export function assertPosEnabled(
  store?: PosFlagStore,
  locale: Locale = FALLBACK_LOCALE,
): { ok: true } | { ok: false; code: "FEATURE_LOCKED"; message: string } {
  if (isPosEnabled(store)) return { ok: true };
  return {
    ok: false,
    code: "FEATURE_LOCKED",
    message: pick(locale, STRINGS).moduleLocked,
  };
}

/** Resolve a scan against a catalog lookup list (SKU first, then barcode field = sku here). */
export function resolveScan(
  payload: ScanPayload,
  catalog: readonly { variantId: string; sku: string; productName: string; pricePoisha: number }[],
): ScanResolution {
  const bySku = catalog.find((c) => c.sku === payload.code);
  if (!bySku) return { matched: false };
  return {
    matched: true,
    variantId: bySku.variantId,
    sku: bySku.sku,
    productName: bySku.productName,
    unitPricePoisha: bySku.pricePoisha,
  };
}

/** Line subtotal + total for a sale input. Integer poisha, discount capped by error (not clamp). */
export function saleTotal(
  input: CreatePosSaleInput,
  locale: Locale = FALLBACK_LOCALE,
): { ok: true; subtotalPoisha: number; totalPoisha: number } | { ok: false; error: string } {
  const subtotalPoisha = input.lines.reduce((sum, l) => sum + l.unitPricePoisha * l.quantity, 0);
  if (input.discountPoisha > subtotalPoisha) {
    return { ok: false, error: pick(locale, STRINGS).discountExceedsSubtotal };
  }
  return { ok: true, subtotalPoisha, totalPoisha: subtotalPoisha - input.discountPoisha };
}

/** Change due for a CASH sale. Errors when tendered is short. */
export function changeDue(
  totalPoisha: number,
  tenderedPoisha: number,
  locale: Locale = FALLBACK_LOCALE,
): { ok: true; changePoisha: number } | { ok: false; error: string } {
  if (tenderedPoisha < totalPoisha) {
    return { ok: false, error: pick(locale, STRINGS).tenderedShort };
  }
  return { ok: true, changePoisha: tenderedPoisha - totalPoisha };
}

export function createSale(
  input: CreatePosSaleInput,
  meta: { id: string; createdAt: string },
  locale: Locale = FALLBACK_LOCALE,
): { ok: true; sale: PosSale } | { ok: false; error: string } {
  const total = saleTotal(input, locale);
  if (!total.ok) return total;
  if (input.paymentMethod === "CASH") {
    if (input.tenderedPoisha === undefined) return { ok: false, error: pick(locale, STRINGS).cashRequiresTendered };
    const change = changeDue(total.totalPoisha, input.tenderedPoisha, locale);
    if (!change.ok) return change;
  }
  const sale: PosSale = {
    id: meta.id,
    shiftId: input.shiftId,
    registerId: input.registerId,
    idempotencyKey: input.idempotencyKey,
    lines: input.lines,
    discountPoisha: input.discountPoisha,
    totalPoisha: total.totalPoisha,
    paymentMethod: input.paymentMethod,
    tenderedPoisha: input.paymentMethod === "CASH" ? input.tenderedPoisha : undefined,
    status: input.offline ? "QUEUED_OFFLINE" : "SYNCED",
    createdAt: meta.createdAt,
    offline: input.offline,
  };
  return { ok: true, sale };
}

/** Expected drawer cash: float + CASH sale totals (VOIDED excluded). */
export function expectedCashPoisha(shift: PosShift, sales: readonly PosSale[]): number {
  const cashSales = sales
    .filter((s) => s.shiftId === shift.id && s.paymentMethod === "CASH" && s.status !== "VOIDED")
    .reduce((sum, s) => sum + s.totalPoisha, 0);
  return shift.openingFloatPoisha + cashSales;
}

export function closeShift(
  shift: PosShift,
  sales: readonly PosSale[],
  input: { countedCashPoisha: number; closedBy: string; closedAt: string; note?: string },
  locale: Locale = FALLBACK_LOCALE,
): { ok: true; shift: PosShift } | { ok: false; error: string } {
  const s = pick(locale, STRINGS);
  if (shift.status !== "OPEN") return { ok: false, error: interpolate(s.shiftAlreadyClosed, { status: shift.status }) };
  const expected = expectedCashPoisha(shift, sales);
  const variance = input.countedCashPoisha - expected;
  if (variance !== 0 && (!input.note || input.note.trim().length === 0)) {
    return { ok: false, error: s.varianceNoteRequired };
  }
  return {
    ok: true,
    shift: {
      ...shift,
      status: "CLOSED",
      closedBy: input.closedBy,
      closedAt: input.closedAt,
      countedCashPoisha: input.countedCashPoisha,
      expectedCashPoisha: expected,
      variancePoisha: variance,
    },
  };
}

export function openShiftForRegister(shifts: readonly PosShift[], registerId: string): PosShift | null {
  return shifts.find((s) => s.registerId === registerId && s.status === "OPEN") ?? null;
}

/** Each POS payment method maps to its OWN shared PaymentMethod key (D3). */
const POS_PAYMENT_METHOD: Record<PosPaymentMethod, PaymentMethod> = {
  CASH: "cod",
  BKASH: "bkash",
  NAGAD: "nagad",
  CARD: "card",
};

/** Receipt labels per POS payment method (D3), per locale (doc 30):
 *  bn keeps the established Bangla-first bilingual receipt style;
 *  en prints the plain English method name. */
function posPaymentLabel(method: PosPaymentMethod, locale: Locale): string {
  const s = pick(locale, STRINGS);
  return { CASH: s.payCash, BKASH: s.payBkash, NAGAD: s.payNagad, CARD: s.payCard }[method];
}

/**
 * Receipt for a POS sale: the shared PrintData shape (invoice / thermal)
 * plus the sale's real payment method + discount, which PrintData itself
 * has no fields for (D3 — extension lives here, PrintData is unchanged).
 */
export type PosReceipt = PosReceiptData & {
  /** The sale's real payment method, as a shared PaymentMethod key. */
  paymentMethod: PaymentMethod;
  /** Display label for that method, e.g. "নগদ (Nagad)". */
  paymentMethodLabel: string;
  /** Formatted discount (e.g. "-৳500"), or null when the sale had none. */
  discountText: string | null;
};

export function buildPosReceipt(
  sale: PosSale,
  format: PrintFormat = "THERMAL_80",
  locale: Locale = FALLBACK_LOCALE,
): PosReceipt {
  const s = pick(locale, STRINGS);
  const paymentMethod = POS_PAYMENT_METHOD[sale.paymentMethod];
  const syntheticOrder: Order = {
    id: sale.id,
    orderNo: `POS-${sale.id.slice(0, 8).toUpperCase()}`,
    customerName: s.walkInCustomer,
    customerPhone: "",
    address: { division: "", district: "", upazila: "", addressLine: "" },
    items: sale.lines.map((l) => ({
      variantId: l.variantId,
      productName: l.productName,
      sku: l.sku,
      quantity: l.quantity,
      unitPricePoisha: l.unitPricePoisha,
    })),
    totalPoisha: sale.totalPoisha,
    paymentMethod,
    paymentStatus: "PAID",
    status: "DELIVERED",
    riskScore: 0,
    tags: ["POS"],
    history: [],
    notes: [],
    createdAt: sale.createdAt,
  };
  const data = buildPrintData(syntheticOrder, "invoice", format, "");
  // Discounted sale: add an explicit discount line so the printed line
  // amounts minus the discount equal the printed total (D3).
  const discountText =
    sale.discountPoisha > 0 ? `-${formatBdt(sale.discountPoisha)}` : null;
  return {
    ...data,
    itemsText: discountText
      ? [...data.itemsText, `${s.discountLine} — ${discountText}`]
      : data.itemsText,
    paymentMethod,
    paymentMethodLabel: posPaymentLabel(sale.paymentMethod, locale),
    discountText,
  };
}
