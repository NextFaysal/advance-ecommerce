/**
 * DB-backed verify-side TrxID claim registry — doc 21 G3-8 (W0-D).
 * Server-only (imports the Prisma client) — API routes import this
 * file directly; src/bd/sms-autoverify.ts stays Prisma-free because
 * its parser/matcher are pure.
 *
 * WHAT THIS REPLACES: the admin BD routes (sms-verify, sms-ingest)
 * used to share `demoTrxRegistry`, an in-process Map from
 * sms-autoverify.ts. Claims reset on every restart/redeploy, so the
 * same (provider, TrxID) could be verified once per process lifetime
 * — double-counted money waiting for a busy day. Claims now live in
 * the SmsTrxClaim table behind @@unique([method, trxId]): the claim
 * insert IS the atomic test-and-set, and a P2002 conflict is the
 * duplicate signal. Nothing here holds state in memory, so a fresh
 * process (or a second instance) sees every prior claim.
 *
 * NOT the same mechanism as the SmsIngestion table (src/bd/
 * sms-ingestion.ts): that dedupes ingestion RECORDS (which SMS
 * arrived, UNIQUE(provider, trxId) on the record). This registry
 * records VERIFICATION CLAIMS (which order a TrxID's money was
 * verified for). An SMS can be ingested without being verified;
 * ingestion consults this registry read-only to flag TrxIDs whose
 * money is already spoken for.
 *
 * The parser and matcher are NOT re-implemented here: autoVerifySmsDb
 * runs the untouched parseMerchantSms + matchSmsToOrder from
 * sms-autoverify.ts, seeding a one-shot InMemoryTrxRegistry with the
 * persisted claim so the matcher's duplicate logic executes exactly
 * as before, then persists a fresh claim atomically on a match.
 */
import { prisma } from "@advance-ecommerce/db";
import {
  InMemoryTrxRegistry,
  matchSmsToOrder,
  normalizeTrxId,
  parseMerchantSms,
  type ExpectedOrderPayment,
  type MerchantProvider,
  type ParseMerchantSmsResult,
  type SmsMatchResult,
} from "./sms-autoverify";

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002";
}

export class DbTrxRegistry {
  /** The orderId this (method, trxId) was verified for, or null. */
  async lookup(provider: MerchantProvider, trxId: string): Promise<string | null> {
    const row = await prisma.smsTrxClaim.findUnique({
      where: { method_trxId: { method: provider, trxId: normalizeTrxId(trxId) } },
      select: { orderId: true },
    });
    return row?.orderId ?? null;
  }

  async has(provider: MerchantProvider, trxId: string): Promise<boolean> {
    return (await this.lookup(provider, trxId)) !== null;
  }

  /**
   * Atomically claim (method, trxId) for an order. Returns false when
   * the pair was already claimed (by any process, at any time) — the
   * UNIQUE index is the arbiter, so concurrent claims cannot both win.
   */
  async claim(provider: MerchantProvider, trxId: string, orderId: string): Promise<boolean> {
    try {
      await prisma.smsTrxClaim.create({
        data: { method: provider, trxId: normalizeTrxId(trxId), orderId },
      });
      return true;
    } catch (e) {
      if (isUniqueViolation(e)) return false;
      throw e;
    }
  }
}

/** Shared DB-backed registry for the admin BD routes. */
export const dbTrxRegistry = new DbTrxRegistry();

/**
 * Async twin of autoVerifySms (sms-autoverify.ts) against the DB
 * registry: parse + match + claim, with identical result shapes and
 * identical match reasons. The only behavioural difference from the
 * in-memory version is durability — and one race the memory version
 * could not have: if a concurrent request claims the pair between
 * this call's lookup and its claim insert, the claim returns false
 * and the result is honestly re-reported as a duplicate of the
 * winning order instead of a verification.
 */
export async function autoVerifySmsDb(
  rawSms: string,
  expected: ExpectedOrderPayment,
  hint?: MerchantProvider,
): Promise<{ parse: ParseMerchantSmsResult; match: SmsMatchResult | null }> {
  const parse = parseMerchantSms(rawSms, hint);
  if (!parse.ok) return { parse, match: null };

  const registry = new InMemoryTrxRegistry();
  const existing = await dbTrxRegistry.lookup(parse.sms.provider, parse.sms.trxId);
  if (existing !== null) registry.register(parse.sms.provider, parse.sms.trxId, existing);

  const match = matchSmsToOrder(parse.sms, expected, registry);
  if (!match.matched) return { parse, match };

  const claimed = await dbTrxRegistry.claim(parse.sms.provider, parse.sms.trxId, expected.orderId);
  if (claimed) return { parse, match };

  const winner = await dbTrxRegistry.lookup(parse.sms.provider, parse.sms.trxId);
  return {
    parse,
    match: {
      matched: false,
      orderId: null,
      reasons: [`duplicate_trxid_already_verified_for_order:${winner ?? "unknown"}`],
      duplicate: true,
      duplicateOfOrderId: winner,
    },
  };
}
