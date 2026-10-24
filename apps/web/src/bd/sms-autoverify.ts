/**
 * bKash / Nagad merchant SMS auto-verify parser — Agent 11, Step 44 (E1).
 * Pure logic, NO real SMS API, NO gateway call.
 *
 * The merchant's own phone receives a confirmation SMS from the provider
 * when a customer pays. Staff (or, later, an Android SMS-forwarder on the
 * merchant phone) paste / forward that text here. This module extracts:
 *   provider, TrxID, amount (integer poisha), sender phone (normalised
 *   +880…, plus a masked form via the validators package — masking is
 *   REUSED from @advance-ecommerce/validators, never re-implemented),
 *   the transaction date, and an optional remaining balance.
 *
 * Auto-verify must never double-count money: a (provider, TrxID) pair may
 * be verified ONCE. Duplicate detection is an interface here
 * (TrxRegistry); the DB implementation must back it with a UNIQUE index on
 * (method, trxId) — the in-memory registry below is the local/demo
 * equivalent and is NOT concurrency-safe.
 *
 * Amount parsing handles "Tk 1,250.00", "Taka 500", "৳2,000" and Bangla
 * digits ("১,২৫০.০০") — amounts are converted with toPoisha() from the
 * validators package so there is exactly one money conversion in the repo.
 *
 * Test cases (input -> expected):
 *  "You have received Tk 1,250.00 from 01712345678. TrxID 9HX7K2P1AB.
 *   Balance Tk 45,300.00. 12/03/2026 14:22" (bKash style) ->
 *    { provider: "bkash", trxId: "9HX7K2P1AB", amountPoisha: 125000,
 *      senderPhone: "+8801712345678", senderPhoneMasked: "+8801******78",
 *      balancePoisha: 4530000 }
 *  "Nagad: You received Tk ৫০০.০০ from +8801812345678, Txn ID: NGD88XYZ12
 *   on 2026-03-12" ->
 *    { provider: "nagad", trxId: "NGD88XYZ12", amountPoisha: 50000 }
 *    (Bangla digits folded before parsing)
 *  "Your OTP is 482910, do not share it." ->
 *    { ok: false, reason: "no_provider" } — provider detection runs first,
 *    so a bare OTP (no provider hint) returns no_provider; no_trxid appears
 *    only when a provider is known/hinted but no TrxID is present
 *    (corrected 2026-10-24). Never parsed as a payment, and an OTP body is
 *    never logged/stored by callers of this module.
 */
import { z } from "zod";
import { maskPhone, normalizeBdPhone, toPoisha } from "@advance-ecommerce/validators";
import { foldBanglaDigits } from "./address-parser";

export type MerchantProvider = "bkash" | "nagad";

export interface ParsedMerchantSms {
  provider: MerchantProvider;
  /** Normalised: uppercase, spaces/dashes stripped. */
  trxId: string;
  amountPoisha: number;
  /** Normalised +8801XXXXXXXXX, or null when the SMS names no sender. */
  senderPhone: string | null;
  /** maskPhone(senderPhone) — safe for logs, lists and audit records. */
  senderPhoneMasked: string | null;
  /** ISO date (yyyy-mm-dd) when a date was present, else null. */
  transactionDate: string | null;
  balancePoisha: number | null;
}

export type ParseMerchantSmsResult =
  | { ok: true; sms: ParsedMerchantSms }
  | { ok: false; reason: "no_provider" | "no_trxid" | "no_amount" | "empty" };

export function normalizeTrxId(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

function parseAmountPoisha(text: string): number | null {
  // First Tk/Taka/৳ amount in the message is the received amount; a later
  // "Balance" amount is handled separately by the caller.
  const match = text.match(/(?:tk\.?|taka|৳)\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!match?.[1]) return null;
  const taka = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(taka) || taka <= 0) return null;
  return toPoisha(taka);
}

function parseBalancePoisha(text: string): number | null {
  const match = text.match(/balance[^0-9৳]*(?:tk\.?|taka|৳)?\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!match?.[1]) return null;
  const taka = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(taka) ? toPoisha(taka) : null;
}

function parseTransactionDate(text: string): string | null {
  const dmy = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (dmy?.[1] && dmy[2] && dmy[3]) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const ymd = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (ymd?.[1] && ymd[2] && ymd[3]) {
    return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  }
  return null;
}

function detectProvider(text: string, hint?: MerchantProvider): MerchantProvider | null {
  if (hint) return hint;
  const lower = text.toLowerCase();
  if (lower.includes("bkash") || lower.includes("বিকাশ")) return "bkash";
  if (lower.includes("nagad") || lower.includes("নগদ")) return "nagad";
  // bKash merchant SMS usually arrives from the "bKash" sender id and
  // always carries a "TrxID" label; Nagad uses "Txn ID". The label alone
  // (without a provider name anywhere) is accepted as a weak signal.
  if (/\btrxid\b/i.test(text)) return "bkash";
  if (/\btxn\s*id\b/i.test(text)) return "nagad";
  return null;
}

export function parseMerchantSms(raw: string, hint?: MerchantProvider): ParseMerchantSmsResult {
  const folded = foldBanglaDigits(raw.trim());
  if (folded.length === 0) return { ok: false, reason: "empty" };
  const provider = detectProvider(folded, hint);
  if (!provider) return { ok: false, reason: "no_provider" };

  const trxMatch = folded.match(/(?:trxid|txn\s*id|transaction\s*id)\s*[:.]?\s*([A-Za-z0-9-]{6,32})/i);
  if (!trxMatch?.[1]) return { ok: false, reason: "no_trxid" };
  const trxId = normalizeTrxId(trxMatch[1]);

  const amountPoisha = parseAmountPoisha(folded);
  if (amountPoisha === null) return { ok: false, reason: "no_amount" };

  const phoneMatch = folded.match(/(?:\+?88)?01[3-9]\d{8}/);
  const senderPhone = phoneMatch ? normalizeBdPhone(phoneMatch[0]) : null;

  return {
    ok: true,
    sms: {
      provider,
      trxId,
      amountPoisha,
      senderPhone,
      senderPhoneMasked: senderPhone ? maskPhone(senderPhone) : null,
      transactionDate: parseTransactionDate(folded),
      balancePoisha: parseBalancePoisha(folded),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Duplicate TrxID registry — interface + in-memory demo implementation */
/* ------------------------------------------------------------------ */

export interface TrxRegistry {
  has(provider: MerchantProvider, trxId: string): boolean;
  /** Returns false when the pair was already registered (duplicate). */
  register(provider: MerchantProvider, trxId: string, orderId: string): boolean;
  lookup(provider: MerchantProvider, trxId: string): string | null;
}

interface TrxRecord {
  orderId: string;
  registeredAt: string;
}

/** In-memory/demo only. The DB implementation must use UNIQUE(method, trxId). */
export class InMemoryTrxRegistry implements TrxRegistry {
  private readonly records = new Map<string, TrxRecord>();

  private key(provider: MerchantProvider, trxId: string): string {
    return `${provider}:${normalizeTrxId(trxId)}`;
  }

  has(provider: MerchantProvider, trxId: string): boolean {
    return this.records.has(this.key(provider, trxId));
  }

  register(provider: MerchantProvider, trxId: string, orderId: string): boolean {
    const key = this.key(provider, trxId);
    if (this.records.has(key)) return false;
    this.records.set(key, { orderId, registeredAt: new Date().toISOString() });
    return true;
  }

  lookup(provider: MerchantProvider, trxId: string): string | null {
    return this.records.get(this.key(provider, trxId))?.orderId ?? null;
  }
}

/** Shared demo registry for the admin BD routes (in-memory-demo persistence). */
export const demoTrxRegistry = new InMemoryTrxRegistry();

/* ------------------------------------------------------------------ */
/* Matching an SMS to an expected order payment                        */
/* ------------------------------------------------------------------ */

export interface ExpectedOrderPayment {
  orderId: string;
  amountPoisha: number;
  /** Customer phone in any BD format, or null when unknown. */
  customerPhone?: string | null;
  provider?: MerchantProvider;
}

export interface SmsMatchResult {
  matched: boolean;
  /** Present when matched: the order this SMS verifies. */
  orderId: string | null;
  reasons: string[];
  duplicate: boolean;
  duplicateOfOrderId: string | null;
}

export function matchSmsToOrder(
  sms: ParsedMerchantSms,
  expected: ExpectedOrderPayment,
  registry: TrxRegistry,
): SmsMatchResult {
  const reasons: string[] = [];
  const existingOrderId = registry.lookup(sms.provider, sms.trxId);
  const duplicate = existingOrderId !== null;
  if (duplicate) reasons.push(`duplicate_trxid_already_verified_for_order:${existingOrderId}`);
  if (expected.provider && sms.provider !== expected.provider) {
    reasons.push(`provider_mismatch:${sms.provider}!=${expected.provider}`);
  }
  if (sms.amountPoisha !== expected.amountPoisha) {
    reasons.push(`amount_mismatch:sms_${sms.amountPoisha}!=expected_${expected.amountPoisha}`);
  }
  if (expected.customerPhone && sms.senderPhone) {
    const expectedPhone = normalizeBdPhone(expected.customerPhone);
    if (expectedPhone && expectedPhone !== sms.senderPhone) {
      reasons.push("sender_phone_mismatch");
    }
  }
  return {
    matched: reasons.length === 0,
    orderId: reasons.length === 0 ? expected.orderId : null,
    reasons,
    duplicate,
    duplicateOfOrderId: existingOrderId,
  };
}

/** Parse + match + register in one call — the auto-verify entry point. */
export function autoVerifySms(
  rawSms: string,
  expected: ExpectedOrderPayment,
  registry: TrxRegistry,
  hint?: MerchantProvider,
): { parse: ParseMerchantSmsResult; match: SmsMatchResult | null } {
  const parse = parseMerchantSms(rawSms, hint);
  if (!parse.ok) return { parse, match: null };
  const match = matchSmsToOrder(parse.sms, expected, registry);
  if (match.matched) registry.register(parse.sms.provider, parse.sms.trxId, expected.orderId);
  return { parse, match };
}

export const parseMerchantSmsInputSchema = z.object({
  smsText: z.string().min(10).max(2000),
  providerHint: z.enum(["bkash", "nagad"]).optional(),
  orderId: z.string().min(1),
  expectedAmountPoisha: z.number().int().positive(),
  customerPhone: z.string().min(11).max(15).optional(),
});
