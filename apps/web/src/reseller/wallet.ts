/**
 * Reseller wallet — append-only ledger logic. Agent 14.
 *
 * Discipline mirrors the stock_movements ledger: balances are NEVER edited
 * directly, they are the sum of ledger entries. Every function here returns a
 * new entry (with balanceAfterPoisha) or an error — a balance can never go
 * negative, and a withdrawal can never exceed the available balance.
 *
 * Persistence note: this module is pure logic over an entries array. The DB
 * implementation stores WalletEntry rows (reseller_wallet_entries, append-only)
 * and computes the balance in the same transaction. See SCHEMA notes in the
 * final report — schema.prisma is owned by Agent 6 and is NOT edited here.
 */
import {
  MIN_WITHDRAWAL_POISHA,
  type Reseller,
  type WalletEntry,
  type WalletEntryType,
  type WithdrawalRequest,
} from "./types";

type ResellerStatusSubject = Pick<Reseller, "id" | "status">;

/**
 * Shared status guard for every wallet action. The reseller record is a
 * required input to the actions below so callers cannot accidentally credit
 * or pay out against an account whose current status they never loaded.
 * Only ACTIVE resellers may receive new credits or create withdrawals;
 * reviewWithdrawal applies this guard specifically to the PAID transition.
 */
function resellerGuardError(
  reseller: ResellerStatusSubject | null,
  expectedResellerId: string,
  action: string,
  enforceActiveStatus: boolean,
): string | null {
  if (!reseller) return `Reseller not found: ${action} is blocked.`;
  if (reseller.id !== expectedResellerId) {
    return `Reseller mismatch: ${action} is blocked.`;
  }
  if (!enforceActiveStatus || reseller.status === "ACTIVE") return null;
  if (reseller.status === "SUSPENDED") {
    return `Reseller status is SUSPENDED: ${action} is blocked until the reseller is ACTIVE again.`;
  }
  return `Reseller status is PENDING_APPROVAL: ${action} is blocked until the reseller is approved and ACTIVE.`;
}

export function walletBalance(entries: readonly WalletEntry[]): number {
  return entries.reduce((sum, e) => sum + e.amountPoisha, 0);
}

/** Poisha currently held for PENDING/APPROVED withdrawals. */
export function pendingWithdrawalTotal(withdrawals: readonly WithdrawalRequest[]): number {
  return withdrawals
    .filter((w) => w.status === "PENDING" || w.status === "APPROVED")
    .reduce((sum, w) => sum + w.amountPoisha, 0);
}

export type LedgerResult =
  | { ok: true; entry: WalletEntry; balancePoisha: number }
  | { ok: false; error: string };

function appendEntry(
  entries: readonly WalletEntry[],
  input: {
    id: string;
    resellerId: string;
    type: WalletEntryType;
    amountPoisha: number;
    orderId?: string;
    withdrawalId?: string;
    note?: string;
    createdAt: string;
  },
): LedgerResult {
  if (!Number.isInteger(input.amountPoisha) || input.amountPoisha === 0) {
    return { ok: false, error: "Ledger amount must be a non-zero integer (poisha)." };
  }
  const balancePoisha = walletBalance(entries) + input.amountPoisha;
  if (balancePoisha < 0) {
    return { ok: false, error: "Insufficient wallet balance for this entry." };
  }
  const entry: WalletEntry = {
    id: input.id,
    resellerId: input.resellerId,
    type: input.type,
    amountPoisha: input.amountPoisha,
    balanceAfterPoisha: balancePoisha,
    orderId: input.orderId,
    withdrawalId: input.withdrawalId,
    note: input.note,
    createdAt: input.createdAt,
  };
  return { ok: true, entry, balancePoisha };
}

/** Credit commission + margin when a reseller order is DELIVERED. Two entries, both >= 0. */
export function creditDeliveredOrder(
  entries: readonly WalletEntry[],
  input: {
    resellerId: string;
    reseller: ResellerStatusSubject | null;
    orderId: string;
    commissionPoisha: number;
    marginPoisha: number;
    idPrefix: string;
    createdAt: string;
  },
): { ok: true; entries: WalletEntry[] } | { ok: false; error: string } {
  const guardError = resellerGuardError(
    input.reseller,
    input.resellerId,
    "delivered-order commission and margin credit",
    true,
  );
  if (guardError) return { ok: false, error: guardError };
  const made: WalletEntry[] = [];
  let working: readonly WalletEntry[] = entries;
  const parts: Array<{ type: WalletEntryType; amount: number; suffix: string }> = [
    { type: "COMMISSION_CREDIT", amount: input.commissionPoisha, suffix: "commission" },
    { type: "MARGIN_CREDIT", amount: input.marginPoisha, suffix: "margin" },
  ];
  for (const part of parts) {
    if (part.amount === 0) continue;
    if (part.amount < 0) return { ok: false, error: "Credit amount cannot be negative." };
    const r = appendEntry(working, {
      id: `${input.idPrefix}-${part.suffix}`,
      resellerId: input.resellerId,
      type: part.type,
      amountPoisha: part.amount,
      orderId: input.orderId,
      createdAt: input.createdAt,
    });
    if (!r.ok) return r;
    made.push(r.entry);
    working = [...working, r.entry];
  }
  return { ok: true, entries: made };
}

/**
 * Request a withdrawal: validates minimum + available balance, returns the
 * request (PENDING) and the WITHDRAWAL_HOLD ledger entry that reserves it.
 * The hold is what stops the same money being withdrawn twice.
 */
export function requestWithdrawal(
  entries: readonly WalletEntry[],
  existing: readonly WithdrawalRequest[],
  input: {
    id: string;
    holdEntryId: string;
    resellerId: string;
    reseller: ResellerStatusSubject | null;
    amountPoisha: number;
    method: WithdrawalRequest["method"];
    accountRefMasked: string;
    createdAt: string;
  },
): { ok: true; request: WithdrawalRequest; holdEntry: WalletEntry } | { ok: false; error: string } {
  const guardError = resellerGuardError(
    input.reseller,
    input.resellerId,
    "withdrawal creation",
    true,
  );
  if (guardError) return { ok: false, error: guardError };
  if (!Number.isInteger(input.amountPoisha) || input.amountPoisha <= 0) {
    return { ok: false, error: "Withdrawal amount must be a positive integer (poisha)." };
  }
  if (input.amountPoisha < MIN_WITHDRAWAL_POISHA) {
    return { ok: false, error: `Minimum withdrawal is ${MIN_WITHDRAWAL_POISHA} poisha.` };
  }
  // A second PENDING/APPROVED request for the same reseller is allowed only up
  // to the free balance — pendingWithdrawalTotal is already reflected because
  // each hold is a negative ledger entry, so walletBalance() is the free balance.
  void existing;
  const hold = appendEntry(entries, {
    id: input.holdEntryId,
    resellerId: input.resellerId,
    type: "WITHDRAWAL_HOLD",
    amountPoisha: -input.amountPoisha,
    withdrawalId: input.id,
    createdAt: input.createdAt,
  });
  if (!hold.ok) return hold;
  const request: WithdrawalRequest = {
    id: input.id,
    resellerId: input.resellerId,
    amountPoisha: input.amountPoisha,
    method: input.method,
    accountRefMasked: input.accountRefMasked,
    status: "PENDING",
    requestedAt: input.createdAt,
  };
  return { ok: true, request, holdEntry: hold.entry };
}

/**
 * Review a withdrawal. PENDING -> APPROVED (no ledger change, hold stays),
 * PENDING|APPROVED -> PAID (settled: hold was the outflow, recorded as a
 * zero-net PAID marker is NOT created — PAID is a status, the money already
 * left the available balance at HOLD time), PENDING|APPROVED -> REJECTED
 * releases the hold back to the available balance.
 */
export function reviewWithdrawal(
  entries: readonly WalletEntry[],
  request: WithdrawalRequest,
  input: {
    action: "APPROVED" | "PAID" | "REJECTED";
    reseller: ResellerStatusSubject | null;
    reviewedBy: string;
    reviewedAt: string;
    note?: string;
    releaseEntryId?: string;
  },
): { ok: true; request: WithdrawalRequest; releaseEntry: WalletEntry | null } | { ok: false; error: string } {
  const guardError = resellerGuardError(
    input.reseller,
    request.resellerId,
    "withdrawal payment",
    input.action === "PAID",
  );
  if (guardError) return { ok: false, error: guardError };
  if (request.status === "PAID" || request.status === "REJECTED") {
    return { ok: false, error: `Withdrawal is already ${request.status} — it cannot be reviewed again.` };
  }
  if (input.action === "PAID" && request.status !== "APPROVED") {
    return { ok: false, error: "Withdrawal must be APPROVED before it can be marked PAID." };
  }
  const updated: WithdrawalRequest = {
    ...request,
    status: input.action,
    reviewedBy: input.reviewedBy,
    reviewedAt: input.reviewedAt,
    reviewNote: input.note,
  };
  if (input.action !== "REJECTED") return { ok: true, request: updated, releaseEntry: null };
  if (!input.releaseEntryId) return { ok: false, error: "releaseEntryId is required when rejecting." };
  const release = appendEntry(entries, {
    id: input.releaseEntryId,
    resellerId: request.resellerId,
    type: "WITHDRAWAL_RELEASE",
    amountPoisha: request.amountPoisha,
    withdrawalId: request.id,
    note: input.note,
    createdAt: input.reviewedAt,
  });
  if (!release.ok) return release;
  return { ok: true, request: updated, releaseEntry: release.entry };
}
