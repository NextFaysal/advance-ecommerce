/**
 * Vendor payout requests — Prisma persistence (schema wave 2).
 * Mirrors src/reseller/payout-store.ts: creation and decision both
 * run in a transaction that takes a row lock (SELECT … FOR UPDATE) —
 * on the Vendor row for creation (serialises the available-balance
 * check per vendor) and on the payout row for decisions. All money
 * rules live in the pure module (payouts.ts); this file loads,
 * locks, persists.
 *
 * The base figure is the commission read model's net payable:
 * Σ VendorCommissionLine.vendorEarningPoisha − Σ VendorRefund,
 * floored at zero — the same arithmetic buildVendorPortalDashboard
 * and summarizePayout produce from the same rows.
 *
 * Honesty: PAID here means "staff recorded an external payment" —
 * nothing in this module moves money.
 */
import { prisma } from "@advance-ecommerce/db";
import { maskPhone } from "../checkout/validation";
import {
  computeVendorPayoutBalances,
  decideVendorPayout,
  validateVendorPayoutAmount,
  type VendorPayoutBalances,
  type VendorPayoutDecision,
  type VendorPayoutRequest,
  type VendorPayoutStatus,
} from "./payouts";

type VendorPayoutRow = NonNullable<
  Awaited<ReturnType<typeof prisma.vendorPayoutRequest.findUnique>>
>;

export function rowToVendorPayoutRequest(row: VendorPayoutRow): VendorPayoutRequest {
  return {
    id: row.id,
    vendorId: row.vendorId,
    amountPoisha: row.amountPoisha,
    method: row.method as VendorPayoutRequest["method"],
    accountNote: row.accountNote,
    status: row.status as VendorPayoutStatus,
    ...(row.decidedById ? { decidedById: row.decidedById } : {}),
    ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}),
    ...(row.paidAt ? { paidAt: row.paidAt.toISOString() } : {}),
    ...(row.note ? { note: row.note } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listVendorPayoutRequests(vendorId?: string): Promise<VendorPayoutRequest[]> {
  const rows = await prisma.vendorPayoutRequest.findMany({
    where: vendorId ? { vendorId } : undefined,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(rowToVendorPayoutRequest);
}

/** Net payable from the commission read model (never below zero). */
export async function getVendorNetPayablePoisha(vendorId: string): Promise<number> {
  const [earnings, refunds] = await Promise.all([
    prisma.vendorCommissionLine.aggregate({
      where: { vendorId },
      _sum: { vendorEarningPoisha: true },
    }),
    prisma.vendorRefund.aggregate({
      where: { vendorId },
      _sum: { amountPoisha: true },
    }),
  ]);
  const net =
    (earnings._sum.vendorEarningPoisha ?? 0) - (refunds._sum.amountPoisha ?? 0);
  return Math.max(0, net);
}

/** Computed payout balances for one vendor (see payouts.ts). */
export async function getVendorPayoutBalancesDb(vendorId: string): Promise<VendorPayoutBalances> {
  const [netPayablePoisha, requests] = await Promise.all([
    getVendorNetPayablePoisha(vendorId),
    listVendorPayoutRequests(vendorId),
  ]);
  return computeVendorPayoutBalances(netPayablePoisha, requests);
}

/**
 * Create a payout request (PENDING). Only ACTIVE vendors may request
 * (the reseller discipline). The vendor row lock makes the balance
 * check + insert atomic per vendor.
 */
export async function createVendorPayoutRequestDb(input: {
  vendorId: string;
  amountPoisha: number;
  method: VendorPayoutRequest["method"];
  accountNote: string;
}): Promise<{ ok: true; request: VendorPayoutRequest } | { ok: false; error: string }> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id", "status" FROM "Vendor" WHERE "id" = ${input.vendorId} FOR UPDATE
    `;
    const vendorRow = locked[0];
    if (!vendorRow) return { ok: false as const, error: "Vendor not found." };
    if (vendorRow.status !== "ACTIVE") {
      return {
        ok: false as const,
        error: `Vendor status is ${vendorRow.status}: payout requests are blocked until the vendor is ACTIVE.`,
      };
    }
    const [lineRows, refundRows, requestRows] = await Promise.all([
      tx.vendorCommissionLine.findMany({
        where: { vendorId: input.vendorId },
        select: { vendorEarningPoisha: true },
      }),
      tx.vendorRefund.findMany({
        where: { vendorId: input.vendorId },
        select: { amountPoisha: true },
      }),
      tx.vendorPayoutRequest.findMany({
        where: { vendorId: input.vendorId },
        select: { status: true, amountPoisha: true },
      }),
    ]);
    const netPayable = Math.max(
      0,
      lineRows.reduce((s, l) => s + l.vendorEarningPoisha, 0) -
        refundRows.reduce((s, r) => s + r.amountPoisha, 0),
    );
    const balances = computeVendorPayoutBalances(
      netPayable,
      requestRows as Array<{ status: VendorPayoutStatus; amountPoisha: number }>,
    );
    const valid = validateVendorPayoutAmount(input.amountPoisha, balances);
    if (!valid.ok) return { ok: false as const, error: valid.error };
    const row = await tx.vendorPayoutRequest.create({
      data: {
        vendorId: input.vendorId,
        amountPoisha: input.amountPoisha,
        method: input.method,
        accountNote: input.accountNote,
        status: "PENDING",
      },
    });
    return { ok: true as const, request: rowToVendorPayoutRequest(row) };
  });
}

/**
 * Decide a payout request (APPROVED / PAID / REJECTED) with the pure
 * state machine. PAID stamps paidAt and records that staff paid
 * externally — it never triggers a transfer. The decision note (when
 * given) is stored on the row and shown to the vendor.
 */
export async function decideVendorPayoutRequestDb(
  payoutId: string,
  input: { action: VendorPayoutDecision; decidedById: string; note?: string | null },
): Promise<
  | { ok: true; request: VendorPayoutRequest }
  | { ok: false; error: string; notFound?: boolean }
> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "VendorPayoutRequest" WHERE "id" = ${payoutId} FOR UPDATE
    `;
    if (!locked[0]) return { ok: false as const, error: "Payout request not found.", notFound: true };
    const row = await tx.vendorPayoutRequest.findUnique({ where: { id: payoutId } });
    if (!row) return { ok: false as const, error: "Payout request not found.", notFound: true };
    const decision = decideVendorPayout(row.status as VendorPayoutStatus, input.action);
    if (!decision.ok) return { ok: false as const, error: decision.error };
    const now = new Date();
    const updated = await tx.vendorPayoutRequest.update({
      where: { id: payoutId },
      data: {
        status: decision.status,
        decidedById: input.decidedById,
        decidedAt: now,
        ...(decision.status === "PAID" ? { paidAt: now } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    });
    return { ok: true as const, request: rowToVendorPayoutRequest(updated) };
  });
}

/** Admin list shape: the request plus the vendor's shop name + MASKED phone. */
export interface AdminVendorPayoutRequest extends VendorPayoutRequest {
  vendorName: string;
  vendorPhoneMasked: string;
}

export async function listVendorPayoutRequestsAdmin(): Promise<AdminVendorPayoutRequest[]> {
  const rows = await prisma.vendorPayoutRequest.findMany({
    orderBy: { createdAt: "desc" },
    include: { vendor: { select: { name: true, phone: true } } },
  });
  return rows.map((row) => ({
    ...rowToVendorPayoutRequest(row),
    vendorName: row.vendor.name,
    vendorPhoneMasked: maskPhone(row.vendor.phone),
  }));
}
