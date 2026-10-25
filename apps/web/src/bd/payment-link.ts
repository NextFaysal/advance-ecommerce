/**
 * Payment link service — Agent 11, Step 44 (E1). Pure logic + a
 * Prisma-backed store (DB swap 2026-10-24, see the store section at the
 * bottom for the schema-drift notes). NO real gateway call.
 *
 * A payment link lets staff send a customer one URL (SMS / WhatsApp /
 * Messenger) to pay a fixed amount for a specific order — used for COD
 * advance, partial payment, and due collection.
 *
 * SECURITY RULE: only the SHA-256 HASH of the token is ever stored (the
 * same rule as session tokens in src/lib/auth.ts). The plain token is
 * returned exactly once, from createPaymentLink(), so the caller can put
 * it in the URL it sends. A leaked database row can therefore never be
 * turned back into a working link. Token comparison is timing-safe.
 *
 * Money is integer poisha. Status transitions are one-way:
 *   active -> paid | expired | cancelled
 * A paid/expired/cancelled link can never return to active, and an expired
 * link can never be marked paid — pay attempts on it are rejected, which
 * the tests below pin down.
 *
 * Test cases:
 *  create(amountPoisha: 50000, ttlMinutes: 60) ->
 *    record.tokenHash !== plainToken, record.status "active",
 *    verify(record, plainToken) === true, verify(record, "wrong") === false
 *  markPaid(activeRecord, now) -> { ok: true, status: "paid" }
 *  markPaid(expiredRecord, now) -> { ok: false } (expiry is checked first)
 *  isExpired(activeRecord, now + 61min) === true
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export type PaymentLinkStatus = "active" | "paid" | "expired" | "cancelled";

export interface PaymentLinkRecord {
  id: string;
  orderId: string;
  /** Integer poisha — the exact amount this link collects. */
  amountPoisha: number;
  /** Purpose note shown to staff: "cod_advance" | "partial" | "due" | free text key. */
  purpose: string;
  /** SHA-256 hex of the plain token. The plain token is NEVER stored. */
  tokenHash: string;
  status: PaymentLinkStatus;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
}

export const createPaymentLinkSchema = z.object({
  orderId: z.string().min(1),
  amountPoisha: z.number().int().positive(),
  purpose: z.string().min(1).max(100).default("cod_advance"),
  ttlMinutes: z.number().int().min(5).max(60 * 24 * 30).default(60 * 48),
  baseUrl: z.string().url().optional(),
});

export type CreatePaymentLinkInput = z.infer<typeof createPaymentLinkSchema>;

export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Injectable for tests; defaults to 32 random bytes, base64url. */
export function generateLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface CreatedPaymentLink {
  record: PaymentLinkRecord;
  /** Returned ONCE — put it in the URL and never store/log it server-side. */
  plainToken: string;
  url: string;
}

export function createPaymentLink(
  input: CreatePaymentLinkInput,
  opts?: { now?: Date; token?: string; id?: string },
): CreatedPaymentLink {
  const parsed = createPaymentLinkSchema.parse(input);
  const now = opts?.now ?? new Date();
  const plainToken = opts?.token ?? generateLinkToken();
  const record: PaymentLinkRecord = {
    id: opts?.id ?? `plink-${hashLinkToken(plainToken).slice(0, 12)}`,
    orderId: parsed.orderId,
    amountPoisha: parsed.amountPoisha,
    purpose: parsed.purpose,
    tokenHash: hashLinkToken(plainToken),
    status: "active",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + parsed.ttlMinutes * 60_000).toISOString(),
    paidAt: null,
    cancelledAt: null,
  };
  const base = (parsed.baseUrl ?? "https://pay.example.invalid").replace(/\/$/, "");
  return { record, plainToken, url: `${base}/pay/${plainToken}` };
}

export function verifyPaymentLinkToken(record: PaymentLinkRecord, token: string): boolean {
  const a = Buffer.from(hashLinkToken(token), "hex");
  const b = Buffer.from(record.tokenHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isPaymentLinkExpired(record: PaymentLinkRecord, now: Date = new Date()): boolean {
  return record.status === "expired" || (record.status === "active" && now.getTime() > Date.parse(record.expiresAt));
}

/** Returns a NEW record (inputs are never mutated). */
export function withEffectiveStatus(record: PaymentLinkRecord, now: Date = new Date()): PaymentLinkRecord {
  if (record.status === "active" && isPaymentLinkExpired(record, now)) {
    return { ...record, status: "expired" };
  }
  return record;
}

export type TransitionResult =
  | { ok: true; record: PaymentLinkRecord }
  | { ok: false; error: string };

export function markPaymentLinkPaid(record: PaymentLinkRecord, now: Date = new Date()): TransitionResult {
  const effective = withEffectiveStatus(record, now);
  if (effective.status === "expired") return { ok: false, error: "Link expired — create a new payment link." };
  if (effective.status !== "active") return { ok: false, error: `Link is ${effective.status}; it cannot be marked paid.` };
  return { ok: true, record: { ...effective, status: "paid", paidAt: now.toISOString() } };
}

export function cancelPaymentLink(record: PaymentLinkRecord, now: Date = new Date()): TransitionResult {
  if (record.status !== "active") return { ok: false, error: `Link is ${record.status}; only active links can be cancelled.` };
  return { ok: true, record: { ...record, status: "cancelled", cancelledAt: now.toISOString() } };
}

/* ------------------------------------------------------------------ */
/* Prisma-backed store (DB swap 2026-10-24).                           */
/* payment_links table: tokenHash (unique), status, expiresAt;         */
/* lookups are by tokenHash, never by plain token. Only the SHA-256     */
/* hash is ever written — the plain token exists only in the create    */
/* response, exactly as before.                                        */
/*                                                                     */
/* SCHEMA DRIFT (reported, worked around — schema NOT changed):        */
/*  - PaymentLink has NO `purpose` column: the purpose is accepted at  */
/*    creation (it is part of the create contract) but cannot persist; */
/*    read-backs report the default "cod_advance".                     */
/*  - PaymentLink has NO `cancelledAt` column: the CANCELLED status    */
/*    persists, the timestamp reads back null.                         */
/*  - PaymentLink.orderId is an optional FK to Order: the caller's     */
/*    order reference (id or orderNo) is resolved to the Order row at  */
/*    write time; an unresolvable order fails the write with           */
/*    SandboxOrderNotFoundError instead of storing an orphan. On read,  */
/*    the order's orderNo is preferred for display, as before.         */
/* ------------------------------------------------------------------ */

import { prisma } from "@advance-ecommerce/db";
import { SandboxOrderNotFoundError, resolveOrderRef } from "../integrations/sandbox/db-store";

type PaymentLinkRowShape = {
  id: string;
  tokenHash: string;
  orderId: string | null;
  amountPoisha: number;
  status: string;
  expiresAt: Date;
  paidAt: Date | null;
  createdAt: Date;
  order: { orderNo: string } | null;
};

function linkRowToRecord(row: PaymentLinkRowShape): PaymentLinkRecord {
  return {
    id: row.id,
    orderId: row.order?.orderNo ?? row.orderId ?? "",
    amountPoisha: row.amountPoisha,
    purpose: "cod_advance", // drift: no purpose column (see header)
    tokenHash: row.tokenHash,
    status: row.status.toLowerCase() as PaymentLinkStatus,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    cancelledAt: null, // drift: no cancelledAt column (see header)
  };
}

const linkStatusEnum = (s: PaymentLinkStatus) => s.toUpperCase() as "ACTIVE" | "PAID" | "EXPIRED" | "CANCELLED";

export class PrismaPaymentLinkStore {
  async add(record: PaymentLinkRecord): Promise<void> {
    const order = await resolveOrderRef(record.orderId);
    if (!order) throw new SandboxOrderNotFoundError(record.orderId);
    await prisma.paymentLink.create({
      data: {
        id: record.id,
        tokenHash: record.tokenHash,
        orderId: order.id,
        amountPoisha: record.amountPoisha,
        status: linkStatusEnum(record.status),
        expiresAt: new Date(record.expiresAt),
        paidAt: record.paidAt ? new Date(record.paidAt) : null,
      },
    });
  }

  async getById(id: string): Promise<PaymentLinkRecord | null> {
    const row = await prisma.paymentLink.findUnique({
      where: { id },
      include: { order: { select: { orderNo: true } } },
    });
    return row ? linkRowToRecord(row) : null;
  }

  async getByToken(token: string): Promise<PaymentLinkRecord | null> {
    const row = await prisma.paymentLink.findUnique({
      where: { tokenHash: hashLinkToken(token) },
      include: { order: { select: { orderNo: true } } },
    });
    return row ? linkRowToRecord(row) : null;
  }

  async update(record: PaymentLinkRecord): Promise<void> {
    await prisma.paymentLink.update({
      where: { id: record.id },
      data: {
        status: linkStatusEnum(record.status),
        paidAt: record.paidAt ? new Date(record.paidAt) : null,
      },
    });
  }

  async listByOrder(orderRef: string): Promise<PaymentLinkRecord[]> {
    const order = await resolveOrderRef(orderRef);
    if (!order) return [];
    const rows = await prisma.paymentLink.findMany({
      where: { orderId: order.id },
      include: { order: { select: { orderNo: true } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(linkRowToRecord);
  }

  /** Newest links across ALL orders — the admin BD Tools list (added
   *  2026-10-25 so the page shows real recent links instead of seeding
   *  a demo link for one hard-coded order). Same read shape as
   *  listByOrder: the record carries the token HASH only, never a token. */
  async listRecent(limit = 20): Promise<PaymentLinkRecord[]> {
    const rows = await prisma.paymentLink.findMany({
      include: { order: { select: { orderNo: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(linkRowToRecord);
  }
}

/** Shared DB-backed store for the admin BD routes + public /pay pages. */
export const paymentLinkStore = new PrismaPaymentLinkStore();
