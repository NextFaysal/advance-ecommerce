/**
 * Reseller DB store — Prisma-backed persistence (Agent-14 module swap).
 *
 * Replaces the in-memory demo store in service.ts for all API routes and
 * the admin page. The pure logic is UNCHANGED and still lives in
 * wallet.ts / pricing.ts / service.ts (buildDashboard): every money
 * action loads the reseller + ledger from the DB, runs the pure
 * function (which enforces the G1 status guards — SUSPENDED /
 * PENDING_APPROVAL resellers get no credit, no withdrawal creation and
 * no review-to-PAID, with status-specific reasons), and persists the
 * resulting rows in ONE transaction.
 *
 * Deliberate TS <-> schema mappings (drift, see final report):
 * - WalletEntry.kind (schema) <-> WalletEntry.type (TS). `refId` carries
 *   the orderId for credit/adjustment entries and the withdrawalId for
 *   WITHDRAWAL_* entries. WalletEntry.note has NO schema column and is
 *   not persisted.
 * - Reseller has no email / lifetimeSalesPoisha columns. Lifetime sales
 *   are DERIVED: the sum of totalPoisha over the DISTINCT orders
 *   referenced by this reseller's credit entries (refId = orderId).
 *   Credits pointing at orders that do not exist contribute 0.
 * - Reseller.tier column stores the tier derived at last write; the
 *   dashboard always re-derives it from lifetime sales (buildDashboard),
 *   so the column's "STANDARD" default never surfaces.
 * - ResellerWithdrawal has no method / reviewedBy / reviewedAt /
 *   reviewNote columns. The operation responses return those fields
 *   from the pure-logic result of the action just performed; list reads
 *   omit `method` (never fabricated).
 * - ResellerPriceEntry stores ONE price (pricePoisha = the reseller's
 *   selling price). sku / productName / basePricePoisha are resolved
 *   from the catalog at read time (variant.costPoisha ?? pricePoisha).
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import { buildDashboard } from "./service";
import { computeMargin, tierForLifetimeSales } from "./pricing";
import {
  type Reseller,
  type ResellerDashboard,
  type ResellerPriceEntry,
  type ResellerPriceInput,
  type ResellerStatus,
  type WalletEntry,
  type WalletEntryType,
  type WithdrawalRequest,
} from "./types";
import { creditDeliveredOrder, requestWithdrawal, reviewWithdrawal } from "./wallet";

type ResellerRow = NonNullable<Awaited<ReturnType<typeof prisma.reseller.findUnique>>>;
type WalletRow = NonNullable<Awaited<ReturnType<typeof prisma.resellerWalletEntry.findUnique>>>;
type WithdrawalRow = NonNullable<Awaited<ReturnType<typeof prisma.resellerWithdrawal.findUnique>>>;
type PriceRow = NonNullable<Awaited<ReturnType<typeof prisma.resellerPriceEntry.findUnique>>>;

const CREDIT_KINDS: readonly WalletEntryType[] = ["COMMISSION_CREDIT", "MARGIN_CREDIT"];

/* ------------------------------------------------------------------ */
/* Row -> TS mappings                                                  */
/* ------------------------------------------------------------------ */

function rowToWalletEntry(row: WalletRow): WalletEntry {
  const type = row.kind as WalletEntryType;
  const isWithdrawal = type.startsWith("WITHDRAWAL");
  return {
    id: row.id,
    resellerId: row.resellerId,
    type,
    amountPoisha: row.amountPoisha,
    balanceAfterPoisha: row.balanceAfterPoisha ?? 0,
    orderId: !isWithdrawal && row.refId ? row.refId : undefined,
    withdrawalId: isWithdrawal && row.refId ? row.refId : undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToWithdrawal(row: WithdrawalRow): WithdrawalRequest {
  return {
    id: row.id,
    resellerId: row.resellerId,
    amountPoisha: row.amountPoisha,
    // No schema column for the payout method — omitted on reads, never
    // fabricated. Create/review responses carry the real method from
    // the pure-logic result of the operation itself.
    method: undefined as unknown as WithdrawalRequest["method"],
    accountRefMasked: row.accountRefMasked,
    status: row.status as WithdrawalRequest["status"],
    requestedAt: row.createdAt.toISOString(),
  };
}

function rowToReseller(row: ResellerRow, lifetimeSalesPoisha: number): Reseller {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    status: row.status as ResellerStatus,
    tier: tierForLifetimeSales(lifetimeSalesPoisha),
    lifetimeSalesPoisha,
    createdAt: row.createdAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** Lifetime DELIVERED sales per reseller, derived from credit entries -> orders. */
async function lifetimeSalesByReseller(resellerIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (resellerIds.length === 0) return result;
  const credits = await prisma.resellerWalletEntry.findMany({
    where: { resellerId: { in: resellerIds }, kind: { in: [...CREDIT_KINDS] }, refId: { not: null } },
    select: { resellerId: true, refId: true },
  });
  const orderIdsByReseller = new Map<string, Set<string>>();
  for (const c of credits) {
    if (!c.refId) continue;
    const set = orderIdsByReseller.get(c.resellerId) ?? new Set<string>();
    set.add(c.refId);
    orderIdsByReseller.set(c.resellerId, set);
  }
  const allOrderIds = [...new Set(credits.map((c) => c.refId).filter((x): x is string => !!x))];
  if (allOrderIds.length === 0) return result;
  const orders = await prisma.order.findMany({
    where: { id: { in: allOrderIds } },
    select: { id: true, totalPoisha: true },
  });
  const totalByOrder = new Map(orders.map((o) => [o.id, o.totalPoisha]));
  for (const [resellerId, ids] of orderIdsByReseller) {
    let sum = 0;
    for (const id of ids) sum += totalByOrder.get(id) ?? 0;
    result.set(resellerId, sum);
  }
  return result;
}

export async function listResellers(): Promise<Reseller[]> {
  const rows = await prisma.reseller.findMany({ orderBy: { createdAt: "asc" } });
  const lifetimes = await lifetimeSalesByReseller(rows.map((r) => r.id));
  return rows.map((r) => rowToReseller(r, lifetimes.get(r.id) ?? 0));
}

export async function getReseller(resellerId: string): Promise<Reseller | null> {
  const row = await prisma.reseller.findUnique({ where: { id: resellerId } });
  if (!row) return null;
  const lifetimes = await lifetimeSalesByReseller([row.id]);
  return rowToReseller(row, lifetimes.get(row.id) ?? 0);
}

export async function listWalletEntries(resellerId: string): Promise<WalletEntry[]> {
  const rows = await prisma.resellerWalletEntry.findMany({
    where: { resellerId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(rowToWalletEntry);
}

export async function listWithdrawals(resellerId?: string): Promise<WithdrawalRequest[]> {
  const rows = await prisma.resellerWithdrawal.findMany({
    where: resellerId ? { resellerId } : undefined,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(rowToWithdrawal);
}

/** Price entries joined to the live catalog (sku / name / base price). */
export async function listPriceEntries(resellerId?: string): Promise<ResellerPriceEntry[]> {
  const rows: PriceRow[] = await prisma.resellerPriceEntry.findMany({
    where: resellerId ? { resellerId } : undefined,
    orderBy: { createdAt: "asc" },
  });
  const out: ResellerPriceEntry[] = [];
  for (const row of rows) {
    if (!row.variantId) continue;
    const variant = await prisma.productVariant.findUnique({
      where: { id: row.variantId },
      include: { product: { select: { titleBn: true } } },
    });
    if (!variant) continue; // catalog entry deleted — nothing truthful to show
    out.push({
      variantId: variant.id,
      sku: variant.sku,
      productName: variant.product.titleBn,
      basePricePoisha: variant.costPoisha ?? variant.pricePoisha,
      resellerPricePoisha: row.pricePoisha,
    });
  }
  return out;
}

/** Dashboards for every reseller — the resellers page + GET route shape. */
export async function buildDashboardsDb(): Promise<ResellerDashboard[]> {
  const resellers = await listResellers();
  const dashboards: ResellerDashboard[] = [];
  for (const reseller of resellers) {
    const [entries, withdrawals, priceEntries] = await Promise.all([
      listWalletEntries(reseller.id),
      listWithdrawals(reseller.id),
      listPriceEntries(reseller.id),
    ]);
    dashboards.push(buildDashboard(reseller, entries, withdrawals, priceEntries));
  }
  return dashboards;
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export async function createReseller(input: { name: string; phone: string }): Promise<Reseller> {
  const row = await prisma.reseller.create({
    data: { name: input.name, phone: input.phone, status: "PENDING_APPROVAL", tier: "BRONZE" },
  });
  return rowToReseller(row, 0);
}

export async function setResellerStatus(
  resellerId: string,
  status: ResellerStatus,
): Promise<Reseller | null> {
  const existing = await prisma.reseller.findUnique({ where: { id: resellerId } });
  if (!existing) return null;
  const row = await prisma.reseller.update({ where: { id: resellerId }, data: { status } });
  const lifetimes = await lifetimeSalesByReseller([row.id]);
  return rowToReseller(row, lifetimes.get(row.id) ?? 0);
}

/**
 * Set (upsert) a reseller's selling price for a variant. The margin rule
 * is enforced by pricing.computeMargin — a price below base is an ERROR,
 * never clamped. Base is the catalog variant's cost (?? selling price).
 */
export async function setResellerPrice(
  resellerId: string,
  input: ResellerPriceInput,
): Promise<{ ok: true; entry: ResellerPriceEntry } | { ok: false; error: string }> {
  const reseller = await prisma.reseller.findUnique({ where: { id: resellerId } });
  if (!reseller) return { ok: false, error: `Reseller not found: ${resellerId}` };
  const variant = await prisma.productVariant.findUnique({
    where: { id: input.variantId },
    include: { product: { select: { titleBn: true } } },
  });
  if (!variant) return { ok: false, error: `Variant not found: ${input.variantId}` };
  const margin = computeMargin(input);
  if (!margin.ok) return margin;
  const existing = await prisma.resellerPriceEntry.findFirst({
    where: { resellerId, variantId: input.variantId },
  });
  if (existing) {
    await prisma.resellerPriceEntry.update({
      where: { id: existing.id },
      data: { pricePoisha: input.resellerPricePoisha },
    });
  } else {
    await prisma.resellerPriceEntry.create({
      data: {
        resellerId,
        productId: variant.productId,
        variantId: variant.id,
        pricePoisha: input.resellerPricePoisha,
      },
    });
  }
  return {
    ok: true,
    entry: {
      variantId: variant.id,
      sku: variant.sku,
      productName: variant.product.titleBn,
      basePricePoisha: input.basePricePoisha,
      resellerPricePoisha: input.resellerPricePoisha,
    },
  };
}

/**
 * Credit commission + margin for a DELIVERED reseller order — the
 * DB-backed counterpart of wallet.creditDeliveredOrder, callable from
 * the order DELIVERED transition path. Idempotent per order: a replay
 * for the same orderId returns the existing entries without writing.
 * Status guard (G1) is enforced by the pure function: non-ACTIVE
 * resellers are refused with a status-specific reason.
 */
export async function creditDeliveredOrderDb(input: {
  resellerId: string;
  orderId: string;
  commissionPoisha: number;
  marginPoisha: number;
}): Promise<
  | { ok: true; entries: WalletEntry[]; duplicate: boolean }
  | { ok: false; error: string }
> {
  return prisma.$transaction(async (tx) => {
    const already = await tx.resellerWalletEntry.findMany({
      where: { resellerId: input.resellerId, refId: input.orderId, kind: { in: [...CREDIT_KINDS] } },
      orderBy: { createdAt: "asc" },
    });
    if (already.length > 0) {
      return { ok: true as const, entries: already.map(rowToWalletEntry), duplicate: true };
    }
    const resellerRow = await tx.reseller.findUnique({ where: { id: input.resellerId } });
    const entries = (
      await tx.resellerWalletEntry.findMany({
        where: { resellerId: input.resellerId },
        orderBy: { createdAt: "asc" },
      })
    ).map(rowToWalletEntry);
    const result = creditDeliveredOrder(entries, {
      resellerId: input.resellerId,
      reseller: resellerRow ? { id: resellerRow.id, status: resellerRow.status as ResellerStatus } : null,
      orderId: input.orderId,
      commissionPoisha: input.commissionPoisha,
      marginPoisha: input.marginPoisha,
      idPrefix: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    if (!result.ok) return { ok: false as const, error: result.error };
    const saved: WalletEntry[] = [];
    for (const entry of result.entries) {
      const row = await tx.resellerWalletEntry.create({
        data: {
          resellerId: entry.resellerId,
          kind: entry.type,
          amountPoisha: entry.amountPoisha,
          balanceAfterPoisha: entry.balanceAfterPoisha,
          refId: entry.orderId ?? null,
        },
      });
      saved.push(rowToWalletEntry(row));
    }
    return { ok: true as const, entries: saved, duplicate: false };
  });
}

/** Create a withdrawal (PENDING) + its WITHDRAWAL_HOLD ledger entry, atomically. */
export async function requestWithdrawalDb(input: {
  resellerId: string;
  amountPoisha: number;
  method: WithdrawalRequest["method"];
  accountRefMasked: string;
}): Promise<
  | { ok: true; request: WithdrawalRequest; holdEntry: WalletEntry }
  | { ok: false; error: string }
> {
  return prisma.$transaction(async (tx) => {
    const resellerRow = await tx.reseller.findUnique({ where: { id: input.resellerId } });
    const entries = (
      await tx.resellerWalletEntry.findMany({
        where: { resellerId: input.resellerId },
        orderBy: { createdAt: "asc" },
      })
    ).map(rowToWalletEntry);
    const existing = (
      await tx.resellerWithdrawal.findMany({ where: { resellerId: input.resellerId } })
    ).map(rowToWithdrawal);
    const now = new Date().toISOString();
    const withdrawalId = randomUUID();
    const result = requestWithdrawal(entries, existing, {
      id: withdrawalId,
      holdEntryId: randomUUID(),
      resellerId: input.resellerId,
      reseller: resellerRow ? { id: resellerRow.id, status: resellerRow.status as ResellerStatus } : null,
      amountPoisha: input.amountPoisha,
      method: input.method,
      accountRefMasked: input.accountRefMasked,
      createdAt: now,
    });
    if (!result.ok) return { ok: false as const, error: result.error };
    await tx.resellerWithdrawal.create({
      data: {
        id: result.request.id,
        resellerId: result.request.resellerId,
        amountPoisha: result.request.amountPoisha,
        accountRefMasked: result.request.accountRefMasked,
        status: result.request.status,
      },
    });
    const holdRow = await tx.resellerWalletEntry.create({
      data: {
        id: result.holdEntry.id,
        resellerId: result.holdEntry.resellerId,
        kind: result.holdEntry.type,
        amountPoisha: result.holdEntry.amountPoisha,
        balanceAfterPoisha: result.holdEntry.balanceAfterPoisha,
        refId: result.holdEntry.withdrawalId ?? null,
      },
    });
    return { ok: true as const, request: result.request, holdEntry: rowToWalletEntry(holdRow) };
  });
}

/** Review a withdrawal (APPROVED / PAID / REJECTED) with the pure state machine. */
export async function reviewWithdrawalDb(
  withdrawalId: string,
  input: { action: "APPROVED" | "PAID" | "REJECTED"; reviewedBy: string; note?: string },
): Promise<
  | { ok: true; request: WithdrawalRequest }
  | { ok: false; error: string; notFound?: boolean }
> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.resellerWithdrawal.findUnique({ where: { id: withdrawalId } });
    if (!row) return { ok: false as const, error: "Withdrawal not found.", notFound: true };
    const resellerRow = await tx.reseller.findUnique({ where: { id: row.resellerId } });
    const entries = (
      await tx.resellerWalletEntry.findMany({
        where: { resellerId: row.resellerId },
        orderBy: { createdAt: "asc" },
      })
    ).map(rowToWalletEntry);
    const result = reviewWithdrawal(entries, rowToWithdrawal(row), {
      action: input.action,
      reseller: resellerRow ? { id: resellerRow.id, status: resellerRow.status as ResellerStatus } : null,
      reviewedBy: input.reviewedBy,
      reviewedAt: new Date().toISOString(),
      note: input.note,
      releaseEntryId: randomUUID(),
    });
    if (!result.ok) return { ok: false as const, error: result.error };
    await tx.resellerWithdrawal.update({
      where: { id: row.id },
      data: { status: result.request.status },
    });
    if (result.releaseEntry) {
      await tx.resellerWalletEntry.create({
        data: {
          id: result.releaseEntry.id,
          resellerId: result.releaseEntry.resellerId,
          kind: result.releaseEntry.type,
          amountPoisha: result.releaseEntry.amountPoisha,
          balanceAfterPoisha: result.releaseEntry.balanceAfterPoisha,
          refId: result.releaseEntry.withdrawalId ?? null,
        },
      });
    }
    // The returned request carries the review metadata from the action
    // just performed (the schema has no columns to persist it — drift).
    return { ok: true as const, request: result.request };
  });
}
