/**
 * COD remittance ledger — doc 17 batch O8 (wave 26).
 *
 * THE GAP THIS CLOSES: since wave 23, COD cash that a courier (or an
 * own rider) collected on a delivered order is recorded as a Payment
 * row — but nothing tracked the settlement side. The only pre-existing
 * "settlement" surface is the sandbox COD report
 * (src/integrations/sandbox/cod-settlement.ts), which recomputes rows
 * from Shipment data on every request and hardcodes every row's
 * status to "pending"; the courier reconciliation module
 * (src/bd/courier-reconciliation.ts) is pure invoice-matching logic
 * with no persistence. Neither can answer "the courier collected ৳X
 * for us, how much did they actually send back, which orders are
 * still missing?" This module is the persistent ledger that can.
 *
 * MODEL (migration 20261025205000_cod_remittance_ledger):
 *   RemittanceBatch — one settlement from one provider for one
 *     collection period: expectedPoisha (computed at creation from
 *     the covered Payment rows), receivedPoisha / feePoisha /
 *     variancePoisha (recorded at receive), status OPEN → RECEIVED →
 *     CLOSED.
 *   RemittanceItem — one covered collection: (batchId, orderId,
 *     paymentId, expectedPoisha). paymentId is UNIQUE in the schema,
 *     so a collection can sit in exactly one batch, ever — enforced
 *     by the database, not by convention.
 *
 * PROVIDER ATTRIBUTION (never guessed): Payment has no provider
 * column. The wave-23 collector (src/courier/order-sync.ts
 * recordCourierCodCollection) writes, for every collection, exactly
 * one Payment (method COD, status PAID, gatewayTransactionId null)
 * AND one OrderNote whose text carries the marker
 * `[courier-cod:<provider>:<eventId>]` and the collected amount
 * ("<n> poisha recorded as collected"). Rider collections use the
 * same helper with provider "rider". A Payment is attributed to a
 * provider ONLY when it pairs 1:1 with a marker note on its order:
 * same amount, the payment created just before its note (the helper
 * creates the Payment, then the note). Any COD Payment that cannot
 * be paired exactly — e.g. an exchange-credit row, or a collection a
 * staff member recorded by hand — is UNATTRIBUTED: it is counted and
 * listed separately and NEVER enters a batch.
 *
 * MONEY RULES: expected is always Σ recorded Payment rows, never an
 * order total (a delivered split-shipment order can legitimately
 * have collected < total — the shipping part may still be
 * outstanding — and the ledger only settles money that was actually
 * recorded as collected). variance = expected − received − fee is
 * computed and STORED at receive time. A batch with a non-zero
 * variance can only be CLOSED with a note: the discrepancy is
 * written down, never silently absorbed.
 */
import { prisma } from "@advance-ecommerce/db";
import { maskPhone } from "@advance-ecommerce/validators";
import { writeAudit } from "@/lib/audit";

export type RemittanceErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "NO_COLLECTIONS"
  | "NOTE_REQUIRED";

export type RemittanceResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: RemittanceErrorCode; error: string };

const fail = (
  code: RemittanceErrorCode,
  error: string,
): { ok: false; code: RemittanceErrorCode; error: string } => ({ ok: false, code, error });

function asResult<T>(run: () => Promise<T>): Promise<RemittanceResult<T>> {
  return run().then(
    (value) => ({ ok: true as const, value }),
    (e: unknown) => {
      if (e instanceof RemittanceServiceError) return fail(e.code, e.message);
      throw e;
    },
  );
}

class RemittanceServiceError extends Error {
  constructor(
    public code: RemittanceErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const bi = (bn: string, en: string) => `${bn} / ${en}`;

// ------------------------------------------------------------------ views

export interface RemittanceBatchView {
  id: string;
  provider: string;
  periodStart: string;
  periodEnd: string;
  expectedPoisha: number;
  receivedPoisha: number | null;
  feePoisha: number | null;
  variancePoisha: number | null;
  status: string;
  receivedAt: string | null;
  note: string | null;
  createdById: string | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RemittanceItemView {
  id: string;
  orderId: string;
  orderNo: string;
  customerName: string;
  customerPhoneMasked: string;
  paymentId: string;
  expectedPoisha: number;
  collectedAt: string;
}

export interface OutstandingOrderView {
  paymentId: string;
  orderId: string;
  orderNo: string;
  customerName: string;
  customerPhoneMasked: string;
  amountPoisha: number;
  collectedAt: string;
  ageDays: number;
}

export interface OutstandingView {
  providers: {
    provider: string;
    count: number;
    totalPoisha: number;
    oldestAgeDays: number;
    orders: OutstandingOrderView[];
  }[];
  unattributed: {
    count: number;
    totalPoisha: number;
    orders: OutstandingOrderView[];
  };
}

// ------------------------------------------------------------- attribution

interface AttributedCollection {
  paymentId: string;
  orderId: string;
  orderNo: string;
  customerName: string;
  customerPhone: string;
  provider: string;
  eventId: string;
  amountPoisha: number;
  collectedAt: Date;
}

interface UnattributedCollection {
  paymentId: string;
  orderId: string;
  orderNo: string;
  customerName: string;
  customerPhone: string;
  amountPoisha: number;
  collectedAt: Date;
}

const MARKER_RE = /\[courier-cod:([^\]]+)\]/;
const AMOUNT_RE = /(\d+) poisha recorded as collected/;
// The collector creates the Payment first and its marker note moments
// later; the pairing window tolerates slow requests without ever
// reaching across days (a same-amount payment from another day must
// not pair with this note).
const PAIR_BEFORE_MS = 30 * 60 * 1000;
const PAIR_AFTER_MS = 2 * 60 * 1000;

/**
 * Pair every recorded COD collection with its provider marker.
 * Exported for the smoke / diagnostics; the ledger functions below
 * are the real consumers.
 */
export async function attributeCodCollections(): Promise<{
  attributed: AttributedCollection[];
  unattributed: UnattributedCollection[];
}> {
  const payments = await prisma.payment.findMany({
    where: {
      method: "COD",
      status: "PAID",
      paidPoisha: { gt: 0 },
      deletedAt: null,
      order: { deletedAt: null },
    },
    select: {
      id: true,
      orderId: true,
      paidPoisha: true,
      createdAt: true,
      order: {
        select: { id: true, orderNo: true, customerName: true, customerPhone: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  if (payments.length === 0) return { attributed: [], unattributed: [] };

  const orderIds = [...new Set(payments.map((p) => p.orderId))];
  const notes = await prisma.orderNote.findMany({
    where: { orderId: { in: orderIds }, text: { contains: "courier-cod:" } },
    select: { orderId: true, text: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  interface Marker {
    provider: string;
    eventId: string;
    amountPoisha: number;
    noteAt: Date;
    used: boolean;
  }
  const markersByOrder = new Map<string, Marker[]>();
  for (const note of notes) {
    const markerMatch = MARKER_RE.exec(note.text);
    const amountMatch = AMOUNT_RE.exec(note.text);
    if (!markerMatch || !amountMatch) continue;
    const inner = markerMatch[1];
    const sep = inner.indexOf(":");
    if (sep <= 0) continue;
    const marker: Marker = {
      provider: inner.slice(0, sep),
      eventId: inner.slice(sep + 1),
      amountPoisha: Number(amountMatch[1]),
      noteAt: note.createdAt,
      used: false,
    };
    const list = markersByOrder.get(note.orderId) ?? [];
    list.push(marker);
    markersByOrder.set(note.orderId, list);
  }

  const attributed: AttributedCollection[] = [];
  const unattributed: UnattributedCollection[] = [];
  const paymentsByOrder = new Map<string, typeof payments>();
  for (const p of payments) {
    const list = paymentsByOrder.get(p.orderId) ?? [];
    list.push(p);
    paymentsByOrder.set(p.orderId, list);
  }
  for (const [orderId, orderPayments] of paymentsByOrder) {
    const markers = markersByOrder.get(orderId) ?? [];
    const usedPayments = new Set<string>();
    // Pair markers (oldest first) with the earliest still-unpaired
    // payment of the same amount inside the pairing window.
    const pairs = new Map<string, Marker>();
    for (const marker of markers) {
      const candidate = orderPayments.find(
        (p) =>
          !usedPayments.has(p.id) &&
          p.paidPoisha === marker.amountPoisha &&
          p.createdAt.getTime() <= marker.noteAt.getTime() + PAIR_AFTER_MS &&
          p.createdAt.getTime() >= marker.noteAt.getTime() - PAIR_BEFORE_MS,
      );
      if (candidate) {
        usedPayments.add(candidate.id);
        pairs.set(candidate.id, marker);
        marker.used = true;
      }
    }
    for (const p of orderPayments) {
      const base = {
        paymentId: p.id,
        orderId,
        orderNo: p.order.orderNo,
        customerName: p.order.customerName,
        customerPhone: p.order.customerPhone,
        amountPoisha: p.paidPoisha,
        collectedAt: p.createdAt,
      };
      const marker = pairs.get(p.id);
      if (marker) {
        attributed.push({ ...base, provider: marker.provider, eventId: marker.eventId });
      } else {
        unattributed.push(base);
      }
    }
  }
  attributed.sort((a, b) => a.collectedAt.getTime() - b.collectedAt.getTime());
  return { attributed, unattributed };
}

async function batchedPaymentIds(paymentIds: string[]): Promise<Set<string>> {
  if (paymentIds.length === 0) return new Set();
  const rows = await prisma.remittanceItem.findMany({
    where: { paymentId: { in: paymentIds } },
    select: { paymentId: true },
  });
  return new Set(rows.map((r) => r.paymentId));
}

// ---------------------------------------------------------------- batches

function toBatchView(
  batch: {
    id: string;
    provider: string;
    periodStart: Date;
    periodEnd: Date;
    expectedPoisha: number;
    receivedPoisha: number | null;
    feePoisha: number | null;
    variancePoisha: number | null;
    status: string;
    receivedAt: Date | null;
    note: string | null;
    createdById: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  itemCount: number,
): RemittanceBatchView {
  return {
    id: batch.id,
    provider: batch.provider,
    periodStart: batch.periodStart.toISOString(),
    periodEnd: batch.periodEnd.toISOString(),
    expectedPoisha: batch.expectedPoisha,
    receivedPoisha: batch.receivedPoisha,
    feePoisha: batch.feePoisha,
    variancePoisha: batch.variancePoisha,
    status: batch.status,
    receivedAt: batch.receivedAt?.toISOString() ?? null,
    note: batch.note,
    createdById: batch.createdById,
    itemCount,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
  };
}

export async function createRemittanceBatch(
  input: { provider: string; periodStart: Date; periodEnd: Date },
  actor: { id: string },
): Promise<RemittanceResult<RemittanceBatchView>> {
  return asResult(async () => {
    const provider = input.provider.trim();
    if (!provider) {
      throw new RemittanceServiceError(
        "INVALID_INPUT",
        bi("প্রোভাইডার আবশ্যক।", "A provider is required."),
      );
    }
    if (
      !(input.periodStart instanceof Date) ||
      Number.isNaN(input.periodStart.getTime()) ||
      !(input.periodEnd instanceof Date) ||
      Number.isNaN(input.periodEnd.getTime()) ||
      input.periodEnd.getTime() < input.periodStart.getTime()
    ) {
      throw new RemittanceServiceError(
        "INVALID_INPUT",
        bi("সময়কাল সঠিক নয়।", "The period is invalid (end must not precede start)."),
      );
    }
    const { attributed } = await attributeCodCollections();
    const inPeriod = attributed.filter(
      (c) =>
        c.provider === provider &&
        c.collectedAt.getTime() >= input.periodStart.getTime() &&
        c.collectedAt.getTime() <= input.periodEnd.getTime(),
    );
    const already = await batchedPaymentIds(inPeriod.map((c) => c.paymentId));
    const eligible = inPeriod.filter((c) => !already.has(c.paymentId));
    if (eligible.length === 0) {
      throw new RemittanceServiceError(
        "NO_COLLECTIONS",
        bi(
          "এই প্রোভাইডার ও সময়কালে ব্যাচে নেওয়ার মতো কোনো অন্তর্ভুক্ত-হয়নি COD সংগ্রহ নেই।",
          "No unbatched COD collections exist for this provider and period.",
        ),
      );
    }
    const expectedPoisha = eligible.reduce((sum, c) => sum + c.amountPoisha, 0);
    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.remittanceBatch.create({
        data: {
          provider,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          expectedPoisha,
          status: "OPEN",
          createdById: actor.id,
        },
      });
      await tx.remittanceItem.createMany({
        data: eligible.map((c) => ({
          batchId: created.id,
          orderId: c.orderId,
          paymentId: c.paymentId,
          expectedPoisha: c.amountPoisha,
        })),
      });
      return created;
    });
    await writeAudit({
      actorId: actor.id,
      action: "remittance.create",
      entityType: "RemittanceBatch",
      entityId: batch.id,
      afterJson: {
        provider,
        periodStart: input.periodStart.toISOString(),
        periodEnd: input.periodEnd.toISOString(),
        expectedPoisha,
        itemCount: eligible.length,
      },
    });
    return toBatchView(batch, eligible.length);
  });
}

export async function receiveRemittance(
  batchId: string,
  input: { receivedPoisha: number; feePoisha: number; note?: string },
  actor: { id: string },
): Promise<RemittanceResult<RemittanceBatchView>> {
  return asResult(async () => {
    if (
      !Number.isInteger(input.receivedPoisha) ||
      input.receivedPoisha < 0 ||
      !Number.isInteger(input.feePoisha) ||
      input.feePoisha < 0
    ) {
      throw new RemittanceServiceError(
        "INVALID_INPUT",
        bi(
          "প্রাপ্ত অর্থ ও ফি অঋণাত্মক পূর্ণ সংখ্যা (পয়সা) হতে হবে।",
          "Received amount and fee must be non-negative integers (poisha).",
        ),
      );
    }
    const batch = await prisma.remittanceBatch.findFirst({
      where: { id: batchId, deletedAt: null },
      include: { _count: { select: { items: true } } },
    });
    if (!batch) {
      throw new RemittanceServiceError(
        "NOT_FOUND",
        bi("রেমিট্যান্স ব্যাচ পাওয়া যায়নি।", "Remittance batch not found."),
      );
    }
    if (batch.status !== "OPEN") {
      throw new RemittanceServiceError(
        "INVALID_STATE",
        bi(
          "শুধু OPEN ব্যাচেই প্রাপ্তি রেকর্ড করা যায়।",
          "Only an OPEN batch can be marked received.",
        ),
      );
    }
    const variancePoisha = batch.expectedPoisha - input.receivedPoisha - input.feePoisha;
    const flipped = await prisma.remittanceBatch.updateMany({
      where: { id: batch.id, status: "OPEN" },
      data: {
        status: "RECEIVED",
        receivedPoisha: input.receivedPoisha,
        feePoisha: input.feePoisha,
        variancePoisha,
        receivedAt: new Date(),
        note: input.note?.trim() ? input.note.trim() : batch.note,
      },
    });
    if (flipped.count === 0) {
      throw new RemittanceServiceError(
        "INVALID_STATE",
        bi("ব্যাচের অবস্থা এরই মধ্যে বদলে গেছে।", "The batch state changed concurrently."),
      );
    }
    await writeAudit({
      actorId: actor.id,
      action: "remittance.receive",
      entityType: "RemittanceBatch",
      entityId: batch.id,
      beforeJson: { status: batch.status, expectedPoisha: batch.expectedPoisha },
      afterJson: {
        status: "RECEIVED",
        receivedPoisha: input.receivedPoisha,
        feePoisha: input.feePoisha,
        variancePoisha,
      },
    });
    const fresh = await prisma.remittanceBatch.findUniqueOrThrow({ where: { id: batch.id } });
    return toBatchView(fresh, batch._count.items);
  });
}

export async function closeRemittance(
  batchId: string,
  input: { note?: string },
  actor: { id: string },
): Promise<RemittanceResult<RemittanceBatchView>> {
  return asResult(async () => {
    const batch = await prisma.remittanceBatch.findFirst({
      where: { id: batchId, deletedAt: null },
      include: { _count: { select: { items: true } } },
    });
    if (!batch) {
      throw new RemittanceServiceError(
        "NOT_FOUND",
        bi("রেমিট্যান্স ব্যাচ পাওয়া যায়নি।", "Remittance batch not found."),
      );
    }
    if (batch.status !== "RECEIVED") {
      throw new RemittanceServiceError(
        "INVALID_STATE",
        bi(
          "শুধু RECEIVED ব্যাচ বন্ধ করা যায় — আগে প্রাপ্তি রেকর্ড করুন।",
          "Only a RECEIVED batch can be closed — record the receipt first.",
        ),
      );
    }
    const note = input.note?.trim() ? input.note.trim() : batch.note;
    if ((batch.variancePoisha ?? 0) !== 0 && !note) {
      throw new RemittanceServiceError(
        "NOTE_REQUIRED",
        bi(
          "এই ব্যাচে অমিল (variance) আছে — বন্ধ করতে হলে অমিলের কারণ নোটে লিখতে হবে।",
          "This batch has a variance — a note explaining the discrepancy is required to close it.",
        ),
      );
    }
    const flipped = await prisma.remittanceBatch.updateMany({
      where: { id: batch.id, status: "RECEIVED" },
      data: { status: "CLOSED", note },
    });
    if (flipped.count === 0) {
      throw new RemittanceServiceError(
        "INVALID_STATE",
        bi("ব্যাচের অবস্থা এরই মধ্যে বদলে গেছে।", "The batch state changed concurrently."),
      );
    }
    await writeAudit({
      actorId: actor.id,
      action: "remittance.close",
      entityType: "RemittanceBatch",
      entityId: batch.id,
      beforeJson: { status: batch.status, variancePoisha: batch.variancePoisha },
      afterJson: { status: "CLOSED", variancePoisha: batch.variancePoisha, note },
    });
    const fresh = await prisma.remittanceBatch.findUniqueOrThrow({ where: { id: batch.id } });
    return toBatchView(fresh, batch._count.items);
  });
}

export async function listRemittanceBatches(input: {
  status?: string;
  provider?: string;
  page: number;
  pageSize: number;
}): Promise<RemittanceResult<{ batches: RemittanceBatchView[]; total: number }>> {
  return asResult(async () => {
    const page = Math.max(1, Math.floor(input.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize) || 25));
    const where = {
      deletedAt: null,
      ...(input.status ? { status: input.status as never } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.remittanceBatch.count({ where }),
      prisma.remittanceBatch.findMany({
        where,
        include: { _count: { select: { items: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      batches: rows.map((r) => toBatchView(r, r._count.items)),
      total,
    };
  });
}

export async function getRemittanceBatch(
  batchId: string,
): Promise<RemittanceResult<{ batch: RemittanceBatchView; items: RemittanceItemView[] }>> {
  return asResult(async () => {
    const batch = await prisma.remittanceBatch.findFirst({
      where: { id: batchId, deletedAt: null },
      include: {
        items: {
          orderBy: { createdAt: "asc" },
          include: {
            order: {
              select: { orderNo: true, customerName: true, customerPhone: true },
            },
            payment: { select: { createdAt: true } },
          },
        },
      },
    });
    if (!batch) {
      throw new RemittanceServiceError(
        "NOT_FOUND",
        bi("রেমিট্যান্স ব্যাচ পাওয়া যায়নি।", "Remittance batch not found."),
      );
    }
    return {
      batch: toBatchView(batch, batch.items.length),
      items: batch.items.map((item) => ({
        id: item.id,
        orderId: item.orderId,
        orderNo: item.order.orderNo,
        customerName: item.order.customerName,
        customerPhoneMasked: maskPhone(item.order.customerPhone),
        paymentId: item.paymentId,
        expectedPoisha: item.expectedPoisha,
        collectedAt: item.payment.createdAt.toISOString(),
      })),
    };
  });
}

// -------------------------------------------------------------- outstanding

const DAY_MS = 24 * 60 * 60 * 1000;
const OUTSTANDING_ORDER_CAP = 100;

export async function getOutstandingRemittances(
  now: Date = new Date(),
): Promise<RemittanceResult<OutstandingView>> {
  return asResult(async () => {
    const { attributed, unattributed } = await attributeCodCollections();
    const batched = await batchedPaymentIds([
      ...attributed.map((c) => c.paymentId),
      ...unattributed.map((c) => c.paymentId),
    ]);
    const open = attributed.filter((c) => !batched.has(c.paymentId));
    const toView = (c: {
      paymentId: string;
      orderId: string;
      orderNo: string;
      customerName: string;
      customerPhone: string;
      amountPoisha: number;
      collectedAt: Date;
    }): OutstandingOrderView => ({
      paymentId: c.paymentId,
      orderId: c.orderId,
      orderNo: c.orderNo,
      customerName: c.customerName,
      customerPhoneMasked: maskPhone(c.customerPhone),
      amountPoisha: c.amountPoisha,
      collectedAt: c.collectedAt.toISOString(),
      ageDays: Math.max(0, Math.floor((now.getTime() - c.collectedAt.getTime()) / DAY_MS)),
    });
    const byProvider = new Map<string, AttributedCollection[]>();
    for (const c of open) {
      const list = byProvider.get(c.provider) ?? [];
      list.push(c);
      byProvider.set(c.provider, list);
    }
    const providers = [...byProvider.entries()]
      .map(([provider, list]) => ({
        provider,
        count: list.length,
        totalPoisha: list.reduce((s, c) => s + c.amountPoisha, 0),
        oldestAgeDays: Math.max(...list.map((c) => toView(c).ageDays)),
        orders: list.slice(0, OUTSTANDING_ORDER_CAP).map(toView),
      }))
      .sort((a, b) => b.totalPoisha - a.totalPoisha);
    const openUnattributed = unattributed.filter((c) => !batched.has(c.paymentId));
    return {
      providers,
      unattributed: {
        count: openUnattributed.length,
        totalPoisha: openUnattributed.reduce((s, c) => s + c.amountPoisha, 0),
        orders: openUnattributed.slice(0, OUTSTANDING_ORDER_CAP).map(toView),
      },
    };
  });
}
