/**
 * Call dispositions — C3 (call-center advanced plan, phase C3).
 *
 * A disposition is the SUB-REASON stamped on a call log at outcome time:
 * the outcome says WHAT happened (CONFIRMED / CANCELLED / …), the
 * disposition says WHY (price, delivery charge, fake order…). The list
 * is canonical and closed — the outcome route validates against it, so
 * reporting and fraud signals never see free-text variants.
 *
 * Fraud signal: FAKE_ORDER and WRONG_NUMBER_CONFIRMED additionally feed
 * the fraud blacklist (src/fraud/lists.ts `fraudListStore`) from the
 * outcome route — the same DB-backed list checkout scores against. The
 * write happens only when the task's full phone was resolved from its
 * linked order; a masked-only number is never blacklisted (it would be
 * useless and could never match). See the outcome route for the guard.
 */
import { z } from "zod";

export type CallDisposition =
  | "PRICE"
  | "DELIVERY_CHARGE"
  | "CHANGED_MIND"
  | "DUPLICATE_ORDER"
  | "FAKE_ORDER"
  | "WRONG_NUMBER_CONFIRMED"
  | "OTHER";

export interface DispositionDef {
  code: CallDisposition;
  labelBn: string;
  labelEn: string;
  /** True when recording this disposition should also blacklist the phone. */
  fraudSignal: boolean;
}

export const CALL_DISPOSITIONS: readonly DispositionDef[] = [
  { code: "PRICE", labelBn: "দাম নিয়ে আপত্তি", labelEn: "Price objection", fraudSignal: false },
  { code: "DELIVERY_CHARGE", labelBn: "ডেলিভারি চার্জ নিয়ে আপত্তি", labelEn: "Delivery charge objection", fraudSignal: false },
  { code: "CHANGED_MIND", labelBn: "মন বদলে গেছে", labelEn: "Changed mind", fraudSignal: false },
  { code: "DUPLICATE_ORDER", labelBn: "ডুপ্লিকেট অর্ডার", labelEn: "Duplicate order", fraudSignal: false },
  { code: "FAKE_ORDER", labelBn: "ভুয়া অর্ডার", labelEn: "Fake order", fraudSignal: true },
  { code: "WRONG_NUMBER_CONFIRMED", labelBn: "নম্বরটি গ্রাহকের নয় (নিশ্চিত)", labelEn: "Number confirmed not the customer's", fraudSignal: true },
  { code: "OTHER", labelBn: "অন্যান্য", labelEn: "Other", fraudSignal: false },
];

export const CALL_DISPOSITION_CODES: readonly CallDisposition[] = CALL_DISPOSITIONS.map((d) => d.code);

/** Dispositions that feed the fraud blacklist when the full phone is known. */
export const FRAUD_SIGNAL_DISPOSITIONS: ReadonlySet<CallDisposition> = new Set(
  CALL_DISPOSITIONS.filter((d) => d.fraudSignal).map((d) => d.code),
);

export const dispositionSchema = z.enum([
  "PRICE",
  "DELIVERY_CHARGE",
  "CHANGED_MIND",
  "DUPLICATE_ORDER",
  "FAKE_ORDER",
  "WRONG_NUMBER_CONFIRMED",
  "OTHER",
]);

export function isCallDisposition(value: unknown): value is CallDisposition {
  return typeof value === "string" && (CALL_DISPOSITION_CODES as readonly string[]).includes(value);
}

export function isFraudSignalDisposition(value: unknown): value is CallDisposition {
  return isCallDisposition(value) && FRAUD_SIGNAL_DISPOSITIONS.has(value);
}

export function dispositionDef(code: CallDisposition): DispositionDef {
  return CALL_DISPOSITIONS.find((d) => d.code === code) ?? CALL_DISPOSITIONS[CALL_DISPOSITIONS.length - 1];
}
