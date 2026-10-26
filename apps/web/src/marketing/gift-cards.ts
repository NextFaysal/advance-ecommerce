/**
 * Gift cards — ADV-18 (doc 22), marketing mechanics pack.
 *
 * Bearer instruments with ledger-derived balances:
 *  - The plaintext code is generated at issue, returned ONCE to the
 *    issuing admin, and never persisted — the row stores only the
 *    SHA-256 hash (unique lookup, the staff-invite-token pattern via
 *    hashSessionToken) and the last 4 characters for display.
 *  - Balance = Σ GiftCardTransaction.amountPoisha over the card's
 *    whole ledger — the ISSUE row (+initialPoisha) written at
 *    creation IS the opening entry, and REDEEM / REFUND_RESTORE /
 *    ADJUST rows move it from there. There is NO stored balance
 *    column, so a balance can never drift from the ledger: a
 *    redemption either writes its REDEEM row (inside the
 *    order-create transaction — see redeemGiftCardInTx) or it does
 *    not happen at all.
 *  - Stored status is only the staff-controlled ACTIVE / DISABLED.
 *    DEPLETED (balance 0) and EXPIRED (expiresAt passed) are derived
 *    at read time by effectiveGiftCardStatus().
 *
 * Redemption discipline (checkout, app/api/v1/public/orders):
 *  1. validateGiftCardForCheckout() — read-only evaluation used to
 *     price the order; a card that fails here is reported in the
 *     response meta and the order proceeds WITHOUT it (the coupon
 *     precedent: a bad code never loses the sale).
 *  2. redeemGiftCardInTx() — inside createOrderRecord's transaction:
 *     locks the card row (SELECT ... FOR UPDATE), recomputes the
 *     balance from the ledger inside the lock, re-validates, and
 *     writes the REDEEM row. Any failure throws
 *     GiftCardRedemptionError and rolls the WHOLE create back — the
 *     customer is never charged full price for an order the
 *     confirmation said was gift-card-paid.
 *  3. restoreGiftCardForCancelledOrder() — the reversal-hooks
 *     CANCELLED path writes REFUND_RESTORE (+redeemed) exactly once
 *     (marker: an existing REFUND_RESTORE row for the same order).
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import { hashSessionToken } from "@/lib/auth";
import type { ProductTypesTx } from "@/catalog/product-types";

export const GIFT_CARD_KINDS = ["ISSUE", "REDEEM", "REFUND_RESTORE", "ADJUST"] as const;
export type GiftCardTransactionKind = (typeof GIFT_CARD_KINDS)[number];

export type GiftCardEffectiveStatus = "ACTIVE" | "DEPLETED" | "DISABLED" | "EXPIRED";

export interface GiftCardView {
  id: string;
  codeLast4: string;
  initialPoisha: number;
  balancePoisha: number;
  status: GiftCardEffectiveStatus;
  storedStatus: string;
  expiresAt: string | null;
  createdById: string;
  createdAt: string;
}

export class GiftCardRedemptionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GiftCardRedemptionError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Codes                                                               */
/* ------------------------------------------------------------------ */

// Unambiguous alphabet (no 0/O/1/I/L) so a code read over the phone
// or copied from a printed card cannot be mis-transcribed.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateGiftCardCode(): string {
  const bytes = randomBytes(12);
  let body = "";
  for (let i = 0; i < 12; i++) {
    body += CODE_ALPHABET[(bytes[i] as number) % CODE_ALPHABET.length];
  }
  return `GC-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

/** Normalizes a submitted code for lookup: case/space/dash tolerant. */
export function normalizeGiftCardCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, "");
}

function hashGiftCardCode(raw: string): string {
  return hashSessionToken(normalizeGiftCardCode(raw));
}

/* ------------------------------------------------------------------ */
/* Balance + status derivation                                         */
/* ------------------------------------------------------------------ */

export async function giftCardBalancePoisha(
  db: Pick<typeof prisma, "giftCardTransaction">,
  giftCardId: string,
): Promise<number> {
  const agg = await db.giftCardTransaction.aggregate({
    where: { giftCardId },
    _sum: { amountPoisha: true },
  });
  return agg._sum.amountPoisha ?? 0;
}

export function effectiveGiftCardStatus(input: {
  storedStatus: string;
  balancePoisha: number;
  expiresAt: Date | null;
  now?: Date;
}): GiftCardEffectiveStatus {
  if (input.storedStatus === "DISABLED") return "DISABLED";
  const now = input.now ?? new Date();
  if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  if (input.balancePoisha <= 0) return "DEPLETED";
  return "ACTIVE";
}

type GiftCardRow = {
  id: string;
  codeLast4: string;
  initialPoisha: number;
  status: string;
  expiresAt: Date | null;
  createdById: string;
  createdAt: Date;
};

async function toView(row: GiftCardRow): Promise<GiftCardView> {
  const balancePoisha = await giftCardBalancePoisha(prisma, row.id);
  return {
    id: row.id,
    codeLast4: row.codeLast4,
    initialPoisha: row.initialPoisha,
    balancePoisha,
    status: effectiveGiftCardStatus({
      storedStatus: row.status,
      balancePoisha,
      expiresAt: row.expiresAt,
    }),
    storedStatus: row.status,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Admin: issue / list / disable                                       */
/* ------------------------------------------------------------------ */

export interface IssuedGiftCard {
  id: string;
  /** Plaintext code — returned ONCE at issue; never stored. */
  code: string;
  codeLast4: string;
  initialPoisha: number;
  expiresAt: string | null;
}

/**
 * Issue `count` cards of `initialPoisha` each in one transaction.
 * Every card gets its ISSUE ledger row (+initialPoisha) written by
 * the same transaction that creates the card, so a card can never
 * exist without its opening entry. A hash collision (astronomically
 * unlikely with 60 bits of entropy) fails the whole batch rather
 * than issuing a duplicate bearer code.
 */
export async function issueGiftCards(input: {
  count: number;
  initialPoisha: number;
  expiresAt?: Date | null;
  createdById: string;
}): Promise<IssuedGiftCard[]> {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 100) {
    throw new GiftCardRedemptionError("INVALID_COUNT", "Issue count must be between 1 and 100.");
  }
  if (!Number.isInteger(input.initialPoisha) || input.initialPoisha <= 0) {
    throw new GiftCardRedemptionError("INVALID_AMOUNT", "Gift card amount must be a positive integer poisha value.");
  }
  const issued: IssuedGiftCard[] = [];
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < input.count; i++) {
      const code = generateGiftCardCode();
      const card = await tx.giftCard.create({
        data: {
          codeHash: hashGiftCardCode(code),
          codeLast4: normalizeGiftCardCode(code).slice(-4),
          initialPoisha: input.initialPoisha,
          status: "ACTIVE",
          expiresAt: input.expiresAt ?? null,
          createdById: input.createdById,
        },
      });
      await tx.giftCardTransaction.create({
        data: {
          giftCardId: card.id,
          orderId: null,
          amountPoisha: input.initialPoisha,
          kind: "ISSUE",
          actorId: input.createdById,
        },
      });
      issued.push({
        id: card.id,
        code,
        codeLast4: card.codeLast4,
        initialPoisha: card.initialPoisha,
        expiresAt: card.expiresAt ? card.expiresAt.toISOString() : null,
      });
    }
  });
  return issued;
}

export async function listGiftCards(limit = 200): Promise<GiftCardView[]> {
  const rows = await prisma.giftCard.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return Promise.all(rows.map(toView));
}

export async function getGiftCardView(id: string): Promise<GiftCardView | null> {
  const row = await prisma.giftCard.findUnique({ where: { id } });
  return row ? toView(row) : null;
}

/** Staff disable: flips the stored status; the ledger is untouched,
 *  so re-enabling is impossible by design — a disabled bearer card
 *  stays disabled (staff issue a replacement instead). */
export async function disableGiftCard(id: string): Promise<GiftCardView | null> {
  const row = await prisma.giftCard.findUnique({ where: { id } });
  if (!row) return null;
  const updated = await prisma.giftCard.update({
    where: { id },
    data: { status: "DISABLED" },
  });
  return toView(updated);
}

/* ------------------------------------------------------------------ */
/* Checkout: validate (read-only) + redeem (in the create tx)          */
/* ------------------------------------------------------------------ */

export type GiftCardValidation =
  | {
      ok: true;
      cardId: string;
      codeLast4: string;
      balancePoisha: number;
      /** min(balance, order total) — the amount this order can use. */
      applicablePoisha: number;
    }
  | {
      ok: false;
      reason: "NOT_FOUND" | "DISABLED" | "EXPIRED" | "DEPLETED";
      reasonBn: string;
      reasonEn: string;
    };

const REASONS = {
  NOT_FOUND: {
    reasonBn: "গিফট কার্ডের কোডটি পাওয়া যায়নি — কোডটি যাচাই করে আবার দিন।",
    reasonEn: "Gift card code not found — please check the code and try again.",
  },
  DISABLED: {
    reasonBn: "এই গিফট কার্ডটি নিষ্ক্রিয় করা হয়েছে।",
    reasonEn: "This gift card has been disabled.",
  },
  EXPIRED: {
    reasonBn: "এই গিফট কার্ডের মেয়াদ শেষ হয়ে গেছে।",
    reasonEn: "This gift card has expired.",
  },
  DEPLETED: {
    reasonBn: "এই গিফট কার্ডের ব্যালেন্স শেষ হয়ে গেছে।",
    reasonEn: "This gift card has no remaining balance.",
  },
} as const;

/**
 * Read-only checkout evaluation: resolves the code, derives the
 * balance from the ledger and caps the applicable amount at the
 * order total. Writes NOTHING — the authoritative re-check happens
 * under the row lock in redeemGiftCardInTx.
 */
export async function validateGiftCardForCheckout(
  rawCode: string,
  orderTotalPoisha: number,
): Promise<GiftCardValidation> {
  const row = await prisma.giftCard.findUnique({
    where: { codeHash: hashGiftCardCode(rawCode) },
  });
  if (!row) return { ok: false, reason: "NOT_FOUND", ...REASONS.NOT_FOUND };
  const balancePoisha = await giftCardBalancePoisha(prisma, row.id);
  const status = effectiveGiftCardStatus({
    storedStatus: row.status,
    balancePoisha,
    expiresAt: row.expiresAt,
  });
  if (status !== "ACTIVE") {
    return { ok: false, reason: status, ...REASONS[status] };
  }
  return {
    ok: true,
    cardId: row.id,
    codeLast4: row.codeLast4,
    balancePoisha,
    applicablePoisha: Math.min(balancePoisha, Math.max(0, orderTotalPoisha)),
  };
}

/**
 * The redemption write, executed INSIDE the order-create transaction
 * (called by createOrderRecord when the route resolved a redemption).
 * Locks the card row, recomputes the balance from the ledger under
 * the lock, re-validates status/expiry/amount, then writes REDEEM
 * (−amount). Throws GiftCardRedemptionError on any failure so the
 * create transaction rolls back in full.
 */
export async function redeemGiftCardInTx(
  tx: ProductTypesTx,
  input: { cardId: string; orderId: string; amountPoisha: number },
): Promise<{ balanceAfterPoisha: number }> {
  if (!Number.isInteger(input.amountPoisha) || input.amountPoisha <= 0) {
    throw new GiftCardRedemptionError("INVALID_AMOUNT", "Gift card redemption amount must be positive.");
  }
  const locked = await tx.$queryRaw<{ id: string; initialPoisha: number; status: string; expiresAt: Date | null }[]>`
    SELECT "id", "initialPoisha", "status", "expiresAt" FROM "GiftCard" WHERE "id" = ${input.cardId} FOR UPDATE`;
  const card = locked[0];
  if (!card) {
    throw new GiftCardRedemptionError("NOT_FOUND", "Gift card no longer exists.");
  }
  const agg = await tx.giftCardTransaction.aggregate({
    where: { giftCardId: card.id },
    _sum: { amountPoisha: true },
  });
  const balancePoisha = agg._sum.amountPoisha ?? 0;
  const status = effectiveGiftCardStatus({
    storedStatus: card.status,
    balancePoisha,
    expiresAt: card.expiresAt,
  });
  if (status !== "ACTIVE") {
    throw new GiftCardRedemptionError(status, `Gift card is ${status.toLowerCase()} at redemption time.`);
  }
  if (input.amountPoisha > balancePoisha) {
    throw new GiftCardRedemptionError(
      "INSUFFICIENT_BALANCE",
      "Gift card balance changed before the order was created; redemption exceeds the remaining balance.",
    );
  }
  // Exactly-once per order: a second REDEEM for the same order id
  // would mean the create funnel ran twice for one order — refuse.
  const existing = await tx.giftCardTransaction.findFirst({
    where: { giftCardId: card.id, orderId: input.orderId, kind: "REDEEM" },
    select: { id: true },
  });
  if (existing) {
    throw new GiftCardRedemptionError("ALREADY_REDEEMED", "This order already redeemed this gift card.");
  }
  await tx.giftCardTransaction.create({
    data: {
      giftCardId: card.id,
      orderId: input.orderId,
      amountPoisha: -input.amountPoisha,
      kind: "REDEEM",
      actorId: null,
    },
  });
  return { balanceAfterPoisha: balancePoisha - input.amountPoisha };
}

/* ------------------------------------------------------------------ */
/* Cancel restore (reversal-hooks CANCELLED path)                      */
/* ------------------------------------------------------------------ */

/**
 * Restore an order's gift-card redemption after the order is
 * CANCELLED: one REFUND_RESTORE row (+redeemed amount) per REDEEM,
 * keyed by the marker check (an existing REFUND_RESTORE for the same
 * card+order), so re-running the reversal hook is a strict no-op.
 * Runs in its own transaction with the card row locked, matching the
 * redeem-side discipline. Never called for RETURNED/REFUNDED orders
 * in this slice — refunds there are staff-channel decisions in the
 * refund workbench (see the wave report).
 */
export async function restoreGiftCardForCancelledOrder(orderId: string): Promise<void> {
  const redeems = await prisma.giftCardTransaction.findMany({
    where: { orderId, kind: "REDEEM" },
    select: { id: true, giftCardId: true, amountPoisha: true },
  });
  for (const redeem of redeems) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "GiftCard" WHERE "id" = ${redeem.giftCardId} FOR UPDATE`;
      const already = await tx.giftCardTransaction.findFirst({
        where: { giftCardId: redeem.giftCardId, orderId, kind: "REFUND_RESTORE" },
        select: { id: true },
      });
      if (already) return;
      await tx.giftCardTransaction.create({
        data: {
          giftCardId: redeem.giftCardId,
          orderId,
          amountPoisha: -redeem.amountPoisha,
          kind: "REFUND_RESTORE",
          actorId: null,
        },
      });
    });
  }
}
