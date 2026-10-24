/**
 * Merchant SMS ingestion pipeline — Agent 49, Step 44 (E1 follow-up).
 * Pure orchestration over the Agent 11 parser (sms-autoverify.ts) — this
 * module parses NOTHING itself; it runs parse -> duplicate check -> order
 * matching and records the outcome for staff review.
 *
 * Two ingestion sources exist because the merchant's confirmation SMS
 * lands on the merchant's own phone:
 *   "android_forwarder" — an Android SMS-forwarder app on that phone
 *     POSTs each provider SMS as it arrives (no provider API exists).
 *   "staff_paste"       — a staff member pastes the SMS text by hand.
 *
 * SAFETY RULES (pinned by the smoke tests):
 *  - Ingestion NEVER marks an order or a payment link paid. A MATCHED
 *    record is only a verification PROPOSAL: the actual payment
 *    confirmation stays with the existing manual-TrxID review flow
 *    (POST /api/v1/admin/payments/manual-trx) / sms-verify. That is why
 *    every record carries `marksPaid: false` as a literal type.
 *  - AMBIGUOUS (more than one candidate order) NEVER auto-picks a winner;
 *    staff choose. Auto-picking could credit the wrong customer's order.
 *  - The raw SMS body is NEVER stored. We keep only:
 *      * the SHA-256 hash of the raw text (dedupe/audit fingerprint),
 *      * the parsed fields (sender phone MASKED only),
 *      * for successfully parsed PAYMENT SMS only, a truncated preview
 *        with the TrxID visible (phone numbers inside it masked), so
 *        staff can eyeball a list row against the phone screen without
 *        opening the record.
 *    A REJECTED body gets NO preview at all: parse failures include OTP
 *    messages, and an OTP body must never be stored or listed — keeping
 *    the hash alone means a rejected OTP leaves no usable trace.
 *  - Idempotency: the same (provider, TrxID) ingested twice returns the
 *    ORIGINAL record with `duplicate: true`; no second record is created.
 *    Dedupe goes through the store's findByTrx, backed by the
 *    sms_ingestions UNIQUE(provider, trxId) constraint.
 *
 * Matching rule (per spec): a candidate order must expect EXACTLY the SMS
 * amount (integer poisha, never a range — partial/over payments are a
 * staff decision, not a matcher guess) AND either the order's customer
 * phone equals the SMS sender, OR the order awaits manual payment
 * (UNPAID/PARTIAL with a manual method — see candidateFromOrder).
 *
 * Persistence: DB-backed since 2026-10-24 (smsIngestionStore, the
 * sms_ingestions table with UNIQUE(provider, trxId)). Orders are matched
 * against whatever candidate list the caller supplies.
 *
 * SCHEMA DRIFT (reported, worked around — schema NOT changed):
 *  - SmsIngestion requires trxId + amountPoisha, so REJECTED records
 *    (unparseable bodies — including OTPs, which must leave no usable
 *    trace anyway) have no DB representation and stay process-local in
 *    the store's memory list.
 *  - The table has no candidates / rejectReason / transactionDate /
 *    receivedAt columns: records read back after a restart lose the
 *    candidate detail (proposedOrderId and duplicateOfId DO persist).
 *    Within a process, the store's cache returns the full record.
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { maskPhone, normalizeBdPhone } from "@advance-ecommerce/validators";
import {
  parseMerchantSms,
  InMemoryTrxRegistry,
  type MerchantProvider,
  type TrxRegistry,
} from "./sms-autoverify";
import type { Order } from "../orders/types";

export type SmsIngestionSource = "android_forwarder" | "staff_paste";

export type SmsIngestionOutcome =
  | "MATCHED"
  | "AMBIGUOUS"
  | "UNMATCHED"
  | "DUPLICATE"
  | "REJECTED";

/* ------------------------------------------------------------------ */
/* Candidate orders                                                    */
/* ------------------------------------------------------------------ */

export interface SmsMatchCandidateOrder {
  orderId: string;
  orderNo: string | null;
  /** Exact expected amount, integer poisha. */
  expectedAmountPoisha: number;
  /** Customer phone in any BD format, or null when unknown. */
  customerPhone: string | null;
  paymentStatus: string;
  paymentMethod: string | null;
  /** True when staff are waiting for a manual payment (TrxID/SMS) for this order. */
  awaitsManualPayment: boolean;
}

/**
 * Adapt a storefront/admin Order to a match candidate. An order "awaits
 * manual payment" when money is still owed (UNPAID or PARTIAL) and the
 * method is a manual mobile-money method (bKash/Nagad) — those are the
 * orders a merchant SMS can belong to without a phone match. COD orders
 * do NOT await manual payment (cash changes hands at the door), so a COD
 * order can only match via the sender-phone rule.
 */
export function candidateFromOrder(order: Order): SmsMatchCandidateOrder {
  const manualMethod = order.paymentMethod === "bkash" || order.paymentMethod === "nagad";
  const moneyOwed = order.paymentStatus === "UNPAID" || order.paymentStatus === "PARTIAL";
  return {
    orderId: order.id,
    orderNo: order.orderNo,
    expectedAmountPoisha: order.totalPoisha,
    customerPhone: order.customerPhone,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    awaitsManualPayment: manualMethod && moneyOwed,
  };
}

export interface SmsCandidateView {
  orderId: string;
  orderNo: string | null;
  expectedAmountPoisha: number;
  /** Masked only — the full customer phone never leaves the matcher. */
  customerPhoneMasked: string | null;
  matchedVia: "phone" | "awaiting_manual_payment" | "phone_and_awaiting_manual_payment";
}

/* ------------------------------------------------------------------ */
/* Ingestion record                                                    */
/* ------------------------------------------------------------------ */

export interface IngestedSmsFields {
  provider: MerchantProvider;
  trxId: string;
  amountPoisha: number;
  /** Masked only — the full sender phone is used transiently to match, never stored. */
  senderPhoneMasked: string | null;
  transactionDate: string | null;
}

export interface SmsIngestionRecord {
  id: string;
  source: SmsIngestionSource;
  /** When the SMS was received (forwarder timestamp or paste time), ISO. */
  receivedAt: string;
  /** When this record was created, ISO. */
  createdAt: string;
  /** SHA-256 hex of the raw SMS text. The raw text itself is NEVER stored. */
  rawTextHash: string;
  /**
   * Truncated preview with the TrxID visible — ONLY for successfully
   * parsed payment SMS. Always null for REJECTED records (an OTP body
   * must never be previewed/stored; see module header).
   */
  preview: string | null;
  parsed: IngestedSmsFields | null;
  outcome: SmsIngestionOutcome;
  /** Parser rejection reason ("no_provider" | "no_trxid" | "no_amount" | "empty"), else null. */
  rejectReason: string | null;
  candidates: SmsCandidateView[];
  /** The single proposed order when outcome is MATCHED — a PROPOSAL for staff, never an applied payment. */
  proposedOrderId: string | null;
  /** Set when outcome is DUPLICATE because sms-verify already verified this TrxID for an order. */
  duplicateOfOrderId: string | null;
  /**
   * Literal false by design: ingestion proposes, it never pays. The
   * payment itself is confirmed only through the manual-TrxID review
   * flow / sms-verify.
   */
  marksPaid: false;
}

/* ------------------------------------------------------------------ */
/* Store — interface + in-memory demo implementation                   */
/* ------------------------------------------------------------------ */

export interface SmsIngestionStore {
  findByTrx(provider: MerchantProvider, trxId: string): Promise<SmsIngestionRecord | null>;
  add(record: SmsIngestionRecord): Promise<void>;
  /** Newest first. */
  list(limit?: number): Promise<SmsIngestionRecord[]>;
}

/**
 * In-memory fixture implementation (tests only — NOT the runtime store).
 * The dedupe index is a TrxRegistry (the interface from sms-autoverify):
 * register() stores the ingestion record id in the registry's reference
 * slot, lookup() finds it again.
 */
export class InMemorySmsIngestionStore implements SmsIngestionStore {
  private readonly byId = new Map<string, SmsIngestionRecord>();
  private readonly trxIndex: TrxRegistry = new InMemoryTrxRegistry();

  async findByTrx(provider: MerchantProvider, trxId: string): Promise<SmsIngestionRecord | null> {
    const id = this.trxIndex.lookup(provider, trxId);
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async add(record: SmsIngestionRecord): Promise<void> {
    this.byId.set(record.id, record);
    if (record.parsed) {
      this.trxIndex.register(record.parsed.provider, record.parsed.trxId, record.id);
    }
  }

  async list(limit = 100): Promise<SmsIngestionRecord[]> {
    return [...this.byId.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}

/* ------------------------------------------------------------------ */
/* Prisma-backed store (runtime)                                       */
/* ------------------------------------------------------------------ */

import { prisma } from "@advance-ecommerce/db";

interface SmsIngestionRowShape {
  id: string;
  provider: string;
  trxId: string;
  amountPoisha: number;
  senderPhoneMasked: string;
  rawTextHash: string;
  preview: string | null;
  source: string;
  outcome: string;
  proposedOrderId: string | null;
  duplicateOfId: string | null;
  createdAt: Date;
}

function smsRowToRecord(row: SmsIngestionRowShape): SmsIngestionRecord {
  return {
    id: row.id,
    source: row.source as SmsIngestionSource,
    receivedAt: row.createdAt.toISOString(), // drift: no receivedAt column
    createdAt: row.createdAt.toISOString(),
    rawTextHash: row.rawTextHash,
    preview: row.preview,
    parsed: {
      provider: row.provider as MerchantProvider,
      trxId: row.trxId,
      amountPoisha: row.amountPoisha,
      senderPhoneMasked: row.senderPhoneMasked === "" ? null : row.senderPhoneMasked,
      transactionDate: null, // drift: no transactionDate column
    },
    outcome: row.outcome as SmsIngestionOutcome,
    rejectReason: null,
    candidates: [], // drift: no candidates column (see module header)
    proposedOrderId: row.proposedOrderId,
    duplicateOfOrderId: row.duplicateOfId,
    marksPaid: false,
  };
}

export class PrismaSmsIngestionStore implements SmsIngestionStore {
  /** Full-fidelity records added in this process (DB rows lose the
   *  candidate detail — see module header). */
  private readonly cache = new Map<string, SmsIngestionRecord>();
  /** REJECTED records: no DB representation (no trxId/amount). */
  private readonly rejected: SmsIngestionRecord[] = [];

  async findByTrx(provider: MerchantProvider, trxId: string): Promise<SmsIngestionRecord | null> {
    for (const record of this.cache.values()) {
      if (record.parsed && record.parsed.provider === provider && record.parsed.trxId === trxId) {
        return record;
      }
    }
    const row = await prisma.smsIngestion.findUnique({
      where: { provider_trxId: { provider, trxId } },
    });
    return row ? smsRowToRecord(row) : null;
  }

  async add(record: SmsIngestionRecord): Promise<void> {
    if (!record.parsed) {
      this.rejected.push(record);
      return;
    }
    this.cache.set(record.id, record);
    try {
      await prisma.smsIngestion.create({
        data: {
          id: record.id,
          provider: record.parsed.provider,
          trxId: record.parsed.trxId,
          amountPoisha: record.parsed.amountPoisha,
          senderPhoneMasked: record.parsed.senderPhoneMasked ?? "",
          rawTextHash: record.rawTextHash,
          preview: record.preview,
          source: record.source,
          outcome: record.outcome,
          proposedOrderId: record.proposedOrderId,
          duplicateOfId: record.duplicateOfOrderId,
        },
      });
    } catch (err) {
      // UNIQUE(provider, trxId) backstop: a concurrent ingest won; the
      // dedupe contract (original record wins) is enforced by findByTrx.
      if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") return;
      throw err;
    }
  }

  async list(limit = 100): Promise<SmsIngestionRecord[]> {
    const rows = await prisma.smsIngestion.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const fromDb = rows.map((row) => this.cache.get(row.id) ?? smsRowToRecord(row));
    const seen = new Set(fromDb.map((r) => r.id));
    const merged = [...fromDb, ...this.rejected.filter((r) => !seen.has(r.id))];
    return merged
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}

/** Shared DB-backed store for the admin sms-ingest route. */
export const smsIngestionStore = new PrismaSmsIngestionStore();

/* ------------------------------------------------------------------ */
/* Pipeline                                                            */
/* ------------------------------------------------------------------ */

export function hashRawSmsText(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

const PREVIEW_LIMIT = 140;

/**
 * Truncated preview of a PARSED payment SMS with the TrxID guaranteed
 * visible (appended when truncation would have cut it off). Every BD
 * phone number in the text is replaced by its masked form first — the
 * preview is an output like any other, and phones are masked in every
 * output. Only ever called with a successfully parsed SMS — rejected
 * bodies (incl. OTPs) get no preview.
 */
export function buildSmsPreview(raw: string, trxId: string): string {
  const phoneMasked = raw.replace(/(?:\+?88)?01[3-9]\d{8}/g, (match) => {
    const normalized = normalizeBdPhone(match);
    return normalized ? maskPhone(normalized) : match;
  });
  const collapsed = phoneMasked.replace(/\s+/g, " ").trim();
  let preview = collapsed.length > PREVIEW_LIMIT ? `${collapsed.slice(0, PREVIEW_LIMIT)}…` : collapsed;
  if (!preview.toUpperCase().includes(trxId.toUpperCase())) {
    preview = `${preview} [TrxID ${trxId}]`;
  }
  return preview;
}

export interface IngestSmsInput {
  smsText: string;
  source: SmsIngestionSource;
  /** ISO timestamp; defaults to now. */
  receivedAt?: string;
  providerHint?: MerchantProvider;
}

export interface IngestSmsDeps {
  store: SmsIngestionStore;
  orders: readonly SmsMatchCandidateOrder[];
  /**
   * Optional read-only view of TrxIDs already VERIFIED through
   * sms-verify (demoTrxRegistry). Consulted with has()/lookup() only —
   * ingestion never registers into it, because registering would claim
   * a verification that has not happened.
   */
  verifiedRegistry?: TrxRegistry;
  now?: Date;
  /** Injectable id for tests; defaults to a random `smsing-…` id. */
  id?: string;
}

export interface IngestSmsResult {
  record: SmsIngestionRecord;
  /** True when this SMS was already ingested and `record` is the original. */
  duplicate: boolean;
}

function findCandidates(
  sms: { amountPoisha: number; senderPhone: string | null },
  orders: readonly SmsMatchCandidateOrder[],
): SmsCandidateView[] {
  const views: SmsCandidateView[] = [];
  for (const order of orders) {
    if (order.expectedAmountPoisha !== sms.amountPoisha) continue;
    const normalized = order.customerPhone ? normalizeBdPhone(order.customerPhone) : null;
    const phoneMatches = sms.senderPhone !== null && normalized !== null && normalized === sms.senderPhone;
    if (!phoneMatches && !order.awaitsManualPayment) continue;
    views.push({
      orderId: order.orderId,
      orderNo: order.orderNo,
      expectedAmountPoisha: order.expectedAmountPoisha,
      customerPhoneMasked: normalized ? maskPhone(normalized) : null,
      matchedVia:
        phoneMatches && order.awaitsManualPayment
          ? "phone_and_awaiting_manual_payment"
          : phoneMatches
            ? "phone"
            : "awaiting_manual_payment",
    });
  }
  return views;
}

export async function ingestSms(input: IngestSmsInput, deps: IngestSmsDeps): Promise<IngestSmsResult> {
  const now = deps.now ?? new Date();
  const createdAt = now.toISOString();
  const receivedAt = input.receivedAt ?? createdAt;
  const rawTextHash = hashRawSmsText(input.smsText);
  const id = deps.id ?? `smsing-${randomBytes(6).toString("hex")}`;

  const parse = parseMerchantSms(input.smsText, input.providerHint);
  if (!parse.ok) {
    const record: SmsIngestionRecord = {
      id,
      source: input.source,
      receivedAt,
      createdAt,
      rawTextHash,
      // No preview: a rejected body may be an OTP — never stored/listed.
      preview: null,
      parsed: null,
      outcome: "REJECTED",
      rejectReason: parse.reason,
      candidates: [],
      proposedOrderId: null,
      duplicateOfOrderId: null,
      marksPaid: false,
    };
    await deps.store.add(record);
    return { record, duplicate: false };
  }

  const sms = parse.sms;

  // Idempotency: same (provider, TrxID) -> original record, no new row.
  const existing = await deps.store.findByTrx(sms.provider, sms.trxId);
  if (existing) return { record: existing, duplicate: true };

  const parsedFields: IngestedSmsFields = {
    provider: sms.provider,
    trxId: sms.trxId,
    amountPoisha: sms.amountPoisha,
    senderPhoneMasked: sms.senderPhoneMasked,
    transactionDate: sms.transactionDate,
  };
  const preview = buildSmsPreview(input.smsText, sms.trxId);

  // Already verified through sms-verify? Then this TrxID's money is
  // spoken for — record a DUPLICATE so staff see the attempt, but never
  // re-propose it against another order.
  const verifiedForOrderId = deps.verifiedRegistry?.lookup(sms.provider, sms.trxId) ?? null;
  if (verifiedForOrderId !== null) {
    const record: SmsIngestionRecord = {
      id,
      source: input.source,
      receivedAt,
      createdAt,
      rawTextHash,
      preview,
      parsed: parsedFields,
      outcome: "DUPLICATE",
      rejectReason: null,
      candidates: [],
      proposedOrderId: null,
      duplicateOfOrderId: verifiedForOrderId,
      marksPaid: false,
    };
    await deps.store.add(record);
    return { record, duplicate: false };
  }

  const candidates = findCandidates(sms, deps.orders);
  const outcome: SmsIngestionOutcome =
    candidates.length === 1 ? "MATCHED" : candidates.length > 1 ? "AMBIGUOUS" : "UNMATCHED";
  const record: SmsIngestionRecord = {
    id,
    source: input.source,
    receivedAt,
    createdAt,
    rawTextHash,
    preview,
    parsed: parsedFields,
    outcome,
    rejectReason: null,
    candidates,
    // Only a single candidate is proposed; AMBIGUOUS never auto-picks.
    proposedOrderId: outcome === "MATCHED" ? (candidates[0]?.orderId ?? null) : null,
    duplicateOfOrderId: null,
    marksPaid: false,
  };
  await deps.store.add(record);
  return { record, duplicate: false };
}

/** Ingest a batch in order; one item's outcome never affects the others. */
export async function ingestSmsBatch(
  items: readonly IngestSmsInput[],
  deps: IngestSmsDeps,
): Promise<IngestSmsResult[]> {
  const results: IngestSmsResult[] = [];
  for (const item of items) {
    results.push(await ingestSms(item, deps));
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* Request validation (route input)                                    */
/* ------------------------------------------------------------------ */

export const ingestSmsItemSchema = z.object({
  smsText: z.string().min(1).max(2000),
  source: z.enum(["android_forwarder", "staff_paste"]),
  receivedAt: z.string().datetime().optional(),
  providerHint: z.enum(["bkash", "nagad"]).optional(),
});

export const ingestSmsBatchSchema = z.object({
  items: z.array(ingestSmsItemSchema).min(1).max(50),
});

/**
 * POST body: a single item, or `{ items: [...] }` (max 50) for batch
 * mode. Batch items are deliberately `unknown` at this layer: the route
 * re-validates each one with ingestSmsItemSchema so a single malformed
 * SMS produces its own per-item error entry instead of failing the whole
 * batch with a 400. (ingestSmsBatchSchema above stays the strict typed
 * shape for fully-trusted internal callers.)
 */
export const ingestSmsRequestSchema = z.union([
  z.object({ items: z.array(z.unknown()).min(1).max(50) }),
  ingestSmsItemSchema,
]);

export type IngestSmsRequest = z.infer<typeof ingestSmsRequestSchema>;

export function isBatchRequest(body: IngestSmsRequest): body is { items: unknown[] } {
  return "items" in body;
}
