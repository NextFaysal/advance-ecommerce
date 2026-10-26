/**
 * Reseller payout requests — Prisma persistence (ADV-12).
 *
 * Concurrency discipline: creation and decision both run in a
 * transaction that takes a row lock (SELECT … FOR UPDATE) — on the
 * Reseller row for creation (serialises balance computation per
 * reseller, so two simultaneous requests cannot both pass the
 * available-balance check) and on the payout row for decisions
 * (serialises the state machine). All money rules themselves live in
 * the pure module (payouts.ts); this file only loads, locks, persists.
 *
 * Honesty: PAID here means "staff recorded an external payment" —
 * nothing in this module moves money.
 */
import { prisma } from "@advance-ecommerce/db";
import { maskPhone } from "../checkout/validation";
import {
  computePayoutBalances,
  decidePayout,
  validatePayoutAmount,
  type PayoutBalances,
  type PayoutDecision,
  type PayoutRequest,
  type PayoutStatus,
} from "./payouts";
import { listWalletEntries } from "./store";
import { walletBalance } from "./wallet";

type PayoutRow = NonNullable<Awaited<ReturnType<typeof prisma.resellerPayoutRequest.findUnique>>>;

export function rowToPayoutRequest(row: PayoutRow): PayoutRequest {
  return {
    id: row.id,
    resellerId: row.resellerId,
    amountPoisha: row.amountPoisha,
    method: row.method as PayoutRequest["method"],
    accountNote: row.accountNote,
    status: row.status as PayoutStatus,
    ...(row.decidedById ? { decidedById: row.decidedById } : {}),
    ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listPayoutRequests(resellerId?: string): Promise<PayoutRequest[]> {
  const rows = await prisma.resellerPayoutRequest.findMany({
    where: resellerId ? { resellerId } : undefined,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(rowToPayoutRequest);
}

/** Computed payout balances for one reseller (see payouts.ts for the model). */
export async function getPayoutBalancesDb(resellerId: string): Promise<PayoutBalances> {
  const [entries, requests] = await Promise.all([
    listWalletEntries(resellerId),
    listPayoutRequests(resellerId),
  ]);
  return computePayoutBalances(walletBalance(entries), requests);
}

/**
 * Create a payout request (PENDING). Only ACTIVE resellers may request.
 * The reseller row lock makes the balance check + insert atomic per
 * reseller.
 */
export async function createPayoutRequestDb(input: {
  resellerId: string;
  amountPoisha: number;
  method: PayoutRequest["method"];
  accountNote: string;
}): Promise<{ ok: true; request: PayoutRequest } | { ok: false; error: string }> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id", "status" FROM "Reseller" WHERE "id" = ${input.resellerId} FOR UPDATE
    `;
    const resellerRow = locked[0];
    if (!resellerRow) return { ok: false as const, error: "Reseller not found." };
    if (resellerRow.status !== "ACTIVE") {
      return {
        ok: false as const,
        error: `Reseller status is ${resellerRow.status}: payout requests are blocked until the reseller is ACTIVE.`,
      };
    }
    const [entryRows, requestRows] = await Promise.all([
      tx.resellerWalletEntry.findMany({
        where: { resellerId: input.resellerId },
        select: { amountPoisha: true },
      }),
      tx.resellerPayoutRequest.findMany({
        where: { resellerId: input.resellerId },
        select: { status: true, amountPoisha: true },
      }),
    ]);
    const balance = entryRows.reduce((sum, e) => sum + e.amountPoisha, 0);
    const balances = computePayoutBalances(balance, requestRows as Array<{ status: PayoutStatus; amountPoisha: number }>);
    const valid = validatePayoutAmount(input.amountPoisha, balances);
    if (!valid.ok) return { ok: false as const, error: valid.error };
    const row = await tx.resellerPayoutRequest.create({
      data: {
        resellerId: input.resellerId,
        amountPoisha: input.amountPoisha,
        method: input.method,
        accountNote: input.accountNote,
        status: "PENDING",
      },
    });
    return { ok: true as const, request: rowToPayoutRequest(row) };
  });
}

/**
 * Decide a payout request (APPROVED / PAID / REJECTED) with the pure
 * state machine. PAID records that staff paid externally — it never
 * triggers a transfer.
 */
export async function decidePayoutRequestDb(
  payoutId: string,
  input: { action: PayoutDecision; decidedById: string },
): Promise<
  | { ok: true; request: PayoutRequest }
  | { ok: false; error: string; notFound?: boolean }
> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "ResellerPayoutRequest" WHERE "id" = ${payoutId} FOR UPDATE
    `;
    if (!locked[0]) return { ok: false as const, error: "Payout request not found.", notFound: true };
    const row = await tx.resellerPayoutRequest.findUnique({ where: { id: payoutId } });
    if (!row) return { ok: false as const, error: "Payout request not found.", notFound: true };
    const decision = decidePayout(row.status as PayoutStatus, input.action);
    if (!decision.ok) return { ok: false as const, error: decision.error };
    const updated = await tx.resellerPayoutRequest.update({
      where: { id: payoutId },
      data: { status: decision.status, decidedById: input.decidedById, decidedAt: new Date() },
    });
    return { ok: true as const, request: rowToPayoutRequest(updated) };
  });
}

/** Admin list shape: the request plus the reseller's name + MASKED phone. */
export interface AdminPayoutRequest extends PayoutRequest {
  resellerName: string;
  resellerPhoneMasked: string;
}

export async function listPayoutRequestsAdmin(): Promise<AdminPayoutRequest[]> {
  const rows = await prisma.resellerPayoutRequest.findMany({
    orderBy: { createdAt: "desc" },
    include: { reseller: { select: { name: true, phone: true } } },
  });
  return rows.map((row) => ({
    ...rowToPayoutRequest(row),
    resellerName: row.reseller.name,
    resellerPhoneMasked: maskPhone(row.reseller.phone),
  }));
}
