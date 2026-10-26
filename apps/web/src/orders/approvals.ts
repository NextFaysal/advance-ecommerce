/**
 * Approval workflows — ADV-27 (doc 22): big-discount orders and
 * large refunds need a manager's approval before money/state moves.
 *
 * WHAT IS GATED
 *  - Order confirm (PENDING -> CONFIRMED): when approvals are enabled
 *    and the order's recorded discount share — discountPoisha /
 *    subtotalPoisha, i.e. coupon + tier + manual discount as recorded
 *    on the order row — reaches the configured threshold
 *    (Settings orders.approvals.discount_threshold_bps, default 3000
 *    = 30%), the confirm is BLOCKED with code APPROVAL_REQUIRED
 *    unless an APPROVED approval record covers the order's CURRENT
 *    discount snapshot. The guard runs inside applyOrderTransition
 *    (src/orders/repository.ts) and in the bulk-actions runner
 *    (src/jobs/bulk-actions.ts) — the two funnels every confirm
 *    passes through — so the admin API, bulk confirm and the
 *    call-center one-click confirm all honour it.
 *  - Refund send (PENDING -> SENT, the step where money actually
 *    leaves): a refund above Settings
 *    orders.approvals.refund_threshold_poisha needs an APPROVED
 *    record for that refund; the guard runs inside updateRefundStatus
 *    (src/orders/refunds.ts). The request is recorded when the refund
 *    is CREATED above the threshold (createRefund calls
 *    noteRefundCreated) so the manager queue shows it before anyone
 *    tries to send.
 *
 * WHO CAN APPROVE: holders of the `orders.edit` permission — in the
 * default role catalogue that is Owner (all permissions) and
 * Manager; Order Processor / Support / Inventory do NOT hold it,
 * which is exactly the requester/approver split the workflow wants.
 * Decisions are audited (orders.approval_decide) by the decide route.
 *
 * PERSISTENCE: approval records live in ONE zod-validated JSON
 * document in the Setting table (key `orders.approvals`) — the
 * established JSON-doc pattern (warehouse.pick_lists,
 * marketing.* docs). No new table, no migration. Records are looked
 * up by orderId (+ refundId for refunds). Read-modify-write on a
 * single doc is the accepted v1 limitation of that pattern (one
 * approval queue, low write volume; last write wins per doc).
 *
 * HONESTY RULES (do not weaken):
 *  - Disabled = fail-open: with orders.approvals.enabled off, no
 *    guard fires and no request is recorded.
 *  - A block always says exactly why (the numbers), who can unblock
 *    it (a manager with orders.edit, by name of the surface:
 *    /admin/approvals) and that the request has been recorded.
 *  - An approval covers ONE discount snapshot: if the order's
 *    discount or subtotal changes after approval, the approval no
 *    longer covers it and a fresh request is recorded.
 *  - Recording a request is idempotent per (kind, orderId,
 *    refundId) while a PENDING request stands or a covering APPROVED
 *    one exists; a REJECTED latest record lets the next blocked
 *    attempt open a NEW request.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { getSetting } from "../lib/settings";

export const APPROVALS_DOC_KEY = "orders.approvals";
export const APPROVAL_REQUIRED_CODE = "APPROVAL_REQUIRED";
/** Permission an approver must hold (Owner + Manager by default). */
export const APPROVAL_DECIDE_PERMISSION = "orders.edit";

const DEFAULT_DISCOUNT_THRESHOLD_BPS = 3000;
const DEFAULT_REFUND_THRESHOLD_POISHA = 100000;
const MAX_RECORDS = 1000;

/* ------------------------------------------------------------------ */
/* Configuration (Settings orders.approvals.*)                           */
/* ------------------------------------------------------------------ */

export interface ApprovalConfig {
  enabled: boolean;
  discountThresholdBps: number;
  refundThresholdPoisha: number;
}

function parseIntSetting(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function getApprovalConfig(): Promise<ApprovalConfig> {
  const [enabled, thresholdBps, refundThreshold] = await Promise.all([
    getSetting("orders.approvals.enabled"),
    getSetting("orders.approvals.discount_threshold_bps"),
    getSetting("orders.approvals.refund_threshold_poisha"),
  ]);
  return {
    enabled: enabled === "true",
    discountThresholdBps: parseIntSetting(thresholdBps, DEFAULT_DISCOUNT_THRESHOLD_BPS, 0, 10000),
    refundThresholdPoisha: parseIntSetting(refundThreshold, DEFAULT_REFUND_THRESHOLD_POISHA, 0, Number.MAX_SAFE_INTEGER),
  };
}

/* ------------------------------------------------------------------ */
/* Document store (Setting JSON doc, zod-validated)                    */
/* ------------------------------------------------------------------ */

const approvalRecordSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["discount", "refund"]),
  orderId: z.string().min(1),
  refundId: z.string().nullable().default(null),
  /** Discount snapshot (kind=discount). */
  discountPoisha: z.number().int().nonnegative().nullable().default(null),
  subtotalPoisha: z.number().int().nonnegative().nullable().default(null),
  discountBps: z.number().int().nonnegative().nullable().default(null),
  thresholdBps: z.number().int().nonnegative().nullable().default(null),
  /** Refund snapshot (kind=refund). */
  amountPoisha: z.number().int().nonnegative().nullable().default(null),
  thresholdPoisha: z.number().int().nonnegative().nullable().default(null),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
  requestedById: z.string().nullable().default(null),
  requestedAt: z.string().min(1),
  decidedById: z.string().nullable().default(null),
  decidedAt: z.string().nullable().default(null),
  decisionReason: z.string().nullable().default(null),
});
export type ApprovalRecord = z.infer<typeof approvalRecordSchema>;

const approvalsDocSchema = z.object({
  version: z.literal(1).default(1),
  records: z.array(approvalRecordSchema).default([]),
});
export type ApprovalsDoc = z.infer<typeof approvalsDocSchema>;

const EMPTY_DOC: ApprovalsDoc = { version: 1, records: [] };

export interface ApprovalDocStore {
  read(): Promise<string | null>;
  write(value: string, actorId: string | null): Promise<void>;
}

export function prismaApprovalDocStore(): ApprovalDocStore {
  return {
    async read() {
      const row = await prisma.setting.findUnique({ where: { key: APPROVALS_DOC_KEY } });
      return row?.value ?? null;
    },
    async write(value, actorId) {
      await prisma.setting.upsert({
        where: { key: APPROVALS_DOC_KEY },
        create: {
          key: APPROVALS_DOC_KEY,
          value,
          valueEncrypted: false,
          isPublic: false,
          category: "general",
          description: "Approval workflow records (JSON, ADV-27)",
          updatedById: actorId,
        },
        update: { value, valueEncrypted: false, updatedById: actorId },
      });
    },
  };
}

export async function readApprovalsDoc(store: ApprovalDocStore = prismaApprovalDocStore()): Promise<ApprovalsDoc> {
  const raw = await store.read();
  if (raw === null || raw.trim() === "") return { ...EMPTY_DOC };
  try {
    const parsed = approvalsDocSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : { ...EMPTY_DOC };
  } catch {
    return { ...EMPTY_DOC };
  }
}

async function writeApprovalsDoc(
  doc: ApprovalsDoc,
  actorId: string | null,
  store: ApprovalDocStore,
): Promise<void> {
  const trimmed: ApprovalsDoc = {
    version: 1,
    records: [...doc.records].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt)).slice(-MAX_RECORDS),
  };
  await store.write(JSON.stringify(trimmed), actorId);
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

/** Discount share in basis points of the subtotal; 0 when either
 *  side is 0 (no discount can never need approval). */
export function discountShareBps(subtotalPoisha: number, discountPoisha: number): number {
  if (subtotalPoisha <= 0 || discountPoisha <= 0) return 0;
  return Math.floor((discountPoisha * 10000) / subtotalPoisha);
}

/** bps -> human percent label: 3000 -> "30", 2950 -> "29.5". */
export function bpsToPercentLabel(bps: number): string {
  const pct = bps / 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function sameKey(a: ApprovalRecord, kind: ApprovalRecord["kind"], orderId: string, refundId: string | null): boolean {
  return a.kind === kind && a.orderId === orderId && (a.refundId ?? null) === refundId;
}

/** Latest record for a (kind, orderId, refundId) key, if any. */
export function latestApproval(
  doc: ApprovalsDoc,
  kind: ApprovalRecord["kind"],
  orderId: string,
  refundId: string | null = null,
): ApprovalRecord | null {
  const matches = doc.records.filter((r) => sameKey(r, kind, orderId, refundId));
  if (matches.length === 0) return null;
  return matches.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))[matches.length - 1];
}

/** An APPROVED discount record covers the order only while the
 *  discount snapshot it approved is still the order's snapshot. */
function coversDiscount(record: ApprovalRecord, subtotalPoisha: number, discountPoisha: number): boolean {
  return (
    record.status === "APPROVED" &&
    record.discountPoisha === discountPoisha &&
    record.subtotalPoisha === subtotalPoisha
  );
}

/* ------------------------------------------------------------------ */
/* Recording (idempotent)                                              */
/* ------------------------------------------------------------------ */

interface RecordRequestInput {
  kind: ApprovalRecord["kind"];
  orderId: string;
  refundId?: string | null;
  discountPoisha?: number | null;
  subtotalPoisha?: number | null;
  discountBps?: number | null;
  thresholdBps?: number | null;
  amountPoisha?: number | null;
  thresholdPoisha?: number | null;
  requestedById: string | null;
}

export async function recordApprovalRequest(
  input: RecordRequestInput,
  store: ApprovalDocStore = prismaApprovalDocStore(),
): Promise<{ record: ApprovalRecord; created: boolean }> {
  const doc = await readApprovalsDoc(store);
  const refundId = input.refundId ?? null;
  const latest = latestApproval(doc, input.kind, input.orderId, refundId);
  if (latest) {
    if (latest.status === "PENDING") return { record: latest, created: false };
    if (
      latest.status === "APPROVED" &&
      (input.kind === "refund" ||
        coversDiscount(latest, input.subtotalPoisha ?? -1, input.discountPoisha ?? -1))
    ) {
      return { record: latest, created: false };
    }
    // Latest is REJECTED (or an APPROVED discount record whose
    // snapshot no longer matches): fall through and open a new one.
  }
  const record: ApprovalRecord = {
    id: randomUUID(),
    kind: input.kind,
    orderId: input.orderId,
    refundId,
    discountPoisha: input.discountPoisha ?? null,
    subtotalPoisha: input.subtotalPoisha ?? null,
    discountBps: input.discountBps ?? null,
    thresholdBps: input.thresholdBps ?? null,
    amountPoisha: input.amountPoisha ?? null,
    thresholdPoisha: input.thresholdPoisha ?? null,
    status: "PENDING",
    requestedById: input.requestedById,
    requestedAt: new Date().toISOString(),
    decidedById: null,
    decidedAt: null,
    decisionReason: null,
  };
  doc.records.push(record);
  await writeApprovalsDoc(doc, input.requestedById, store);
  return { record, created: true };
}

/* ------------------------------------------------------------------ */
/* Guards (used by the transition funnels)                             */
/* ------------------------------------------------------------------ */

export interface ApprovalBlock {
  code: typeof APPROVAL_REQUIRED_CODE;
  message: string;
  record: ApprovalRecord;
}

function discountBlockMessage(orderNo: string | null, bps: number, thresholdBps: number): string {
  const pct = bpsToPercentLabel(bps);
  const tpct = bpsToPercentLabel(thresholdBps);
  const label = orderNo ? `অর্ডার ${orderNo}` : "এই অর্ডার";
  return (
    `${label}-এ ছাড় ${pct}% — অনুমোদনের সীমা ${tpct}%। ম্যানেজারের অনুমোদন ছাড়া অর্ডারটি নিশ্চিত করা যাবে না। ` +
    `আপনার অনুরোধ রেকর্ড করা হয়েছে — orders.edit অনুমতি থাকা ম্যানেজার/ওনার /admin/approvals থেকে অনুমোদন দিলে তারপর নিশ্চিত করা যাবে। / ` +
    `Discount on ${orderNo ? `order ${orderNo}` : "this order"} is ${pct}% — the approval threshold is ${tpct}%. ` +
    `It cannot be confirmed until a manager approves it. Your request has been recorded; a manager/owner holding the ` +
    `${APPROVAL_DECIDE_PERMISSION} permission can approve it at /admin/approvals, after which confirming proceeds normally.`
  );
}

function refundBlockMessage(amountPoisha: number, thresholdPoisha: number): string {
  return (
    `এই রিফান্ডের পরিমাণ ${amountPoisha} পয়সা — অনুমোদনের সীমা ${thresholdPoisha} পয়সা। ম্যানেজারের অনুমোদন ছাড়া রিফান্ড পাঠানো যাবে না। ` +
    `অনুরোধ রেকর্ড করা হয়েছে — orders.edit অনুমতি থাকা ম্যানেজার/ওনার /admin/approvals থেকে অনুমোদন দিন। / ` +
    `This refund is ${amountPoisha} poisha — the approval threshold is ${thresholdPoisha} poisha. ` +
    `It cannot be sent until a manager approves it. The request is recorded; a manager/owner holding the ` +
    `${APPROVAL_DECIDE_PERMISSION} permission can approve it at /admin/approvals.`
  );
}

/**
 * The confirm guard. Returns null when the confirm may proceed
 * (approvals disabled, discount below threshold, or a covering
 * approval stands). When it blocks, the approval request has
 * ALREADY been recorded (idempotently) before returning.
 */
export async function discountApprovalConfirmBlock(
  order: { id: string; orderNo: string | null; subtotalPoisha: number; discountPoisha: number },
  actorId: string | null,
  store: ApprovalDocStore = prismaApprovalDocStore(),
): Promise<ApprovalBlock | null> {
  const config = await getApprovalConfig();
  if (!config.enabled) return null;
  const bps = discountShareBps(order.subtotalPoisha, order.discountPoisha);
  if (order.discountPoisha <= 0 || bps < config.discountThresholdBps) return null;

  const doc = await readApprovalsDoc(store);
  const latest = latestApproval(doc, "discount", order.id, null);
  if (latest && coversDiscount(latest, order.subtotalPoisha, order.discountPoisha)) return null;

  const { record } = await recordApprovalRequest(
    {
      kind: "discount",
      orderId: order.id,
      discountPoisha: order.discountPoisha,
      subtotalPoisha: order.subtotalPoisha,
      discountBps: bps,
      thresholdBps: config.discountThresholdBps,
      requestedById: actorId,
    },
    store,
  );
  return {
    code: APPROVAL_REQUIRED_CODE,
    message: discountBlockMessage(order.orderNo, bps, config.discountThresholdBps),
    record,
  };
}

/** Same guard for callers (the bulk runner) that hold only an order
 *  id: loads the money snapshot from the order row itself. */
export async function discountApprovalConfirmBlockByOrderId(
  orderId: string,
  actorId: string | null,
  store: ApprovalDocStore = prismaApprovalDocStore(),
): Promise<ApprovalBlock | null> {
  const config = await getApprovalConfig();
  if (!config.enabled) return null;
  const row = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNo: true, subtotalPoisha: true, discountPoisha: true },
  });
  if (!row) return null;
  return discountApprovalConfirmBlock(row, actorId, store);
}

/**
 * Records a refund approval request when a refund is created above
 * the threshold. Best-effort by contract (never throws): refund
 * creation must not fail because approval bookkeeping did.
 */
export async function noteRefundCreated(
  refund: { id: string; orderId: string; amountPoisha: number },
  actorId: string | null,
  store: ApprovalDocStore = prismaApprovalDocStore(),
): Promise<void> {
  try {
    const config = await getApprovalConfig();
    if (!config.enabled) return;
    if (refund.amountPoisha <= config.refundThresholdPoisha) return;
    await recordApprovalRequest(
      {
        kind: "refund",
        orderId: refund.orderId,
        refundId: refund.id,
        amountPoisha: refund.amountPoisha,
        thresholdPoisha: config.refundThresholdPoisha,
        requestedById: actorId,
      },
      store,
    );
  } catch {
    // Deliberate: the SENT guard re-checks and records if needed.
  }
}

/**
 * The refund-send guard (updateRefundStatus, to === "SENT").
 * Returns null when the send may proceed; when it blocks, the
 * request has been recorded (idempotently).
 */
export async function refundApprovalBlock(
  refund: { id: string; orderId: string; amountPoisha: number },
  actorId: string | null,
  store: ApprovalDocStore = prismaApprovalDocStore(),
): Promise<ApprovalBlock | null> {
  const config = await getApprovalConfig();
  if (!config.enabled) return null;
  if (refund.amountPoisha <= config.refundThresholdPoisha) return null;

  const doc = await readApprovalsDoc(store);
  const latest = latestApproval(doc, "refund", refund.orderId, refund.id);
  if (latest && latest.status === "APPROVED") return null;

  const { record } = await recordApprovalRequest(
    {
      kind: "refund",
      orderId: refund.orderId,
      refundId: refund.id,
      amountPoisha: refund.amountPoisha,
      thresholdPoisha: config.refundThresholdPoisha,
      requestedById: actorId,
    },
    store,
  );
  return {
    code: APPROVAL_REQUIRED_CODE,
    message: refundBlockMessage(refund.amountPoisha, config.refundThresholdPoisha),
    record,
  };
}

/* ------------------------------------------------------------------ */
/* Decisions                                                           */
/* ------------------------------------------------------------------ */

export type DecideApprovalResult =
  | { ok: true; record: ApprovalRecord }
  | { ok: false; code: string; message: string };

export async function decideApproval(
  id: string,
  decision: "APPROVED" | "REJECTED",
  actor: { id: string },
  reason?: string | null,
  store: ApprovalDocStore = prismaApprovalDocStore(),
): Promise<DecideApprovalResult> {
  const trimmedReason = reason?.trim() ? reason.trim() : null;
  if (decision === "REJECTED" && !trimmedReason) {
    return {
      ok: false,
      code: "REASON_REQUIRED",
      message: "Reject করতে কারণ আবশ্যক। / A reason is required to reject an approval request.",
    };
  }
  const doc = await readApprovalsDoc(store);
  const record = doc.records.find((r) => r.id === id);
  if (!record) {
    return { ok: false, code: "NOT_FOUND", message: "Approval request not found. / অনুরোধটি পাওয়া যায়নি।" };
  }
  if (record.status !== "PENDING") {
    return {
      ok: false,
      code: "ALREADY_DECIDED",
      message: `This request was already ${record.status.toLowerCase()}. / এই অনুরোধের সিদ্ধান্ত আগেই নেওয়া হয়েছে।`,
    };
  }
  record.status = decision;
  record.decidedById = actor.id;
  record.decidedAt = new Date().toISOString();
  record.decisionReason = trimmedReason;
  await writeApprovalsDoc(doc, actor.id, store);
  return { ok: true, record };
}

/* ------------------------------------------------------------------ */
/* Read models (queue + per-order state)                               */
/* ------------------------------------------------------------------ */

export interface ApprovalQueueEntry extends ApprovalRecord {
  orderNo: string | null;
  orderStatus: string | null;
  customerName: string | null;
  requestedByName: string | null;
  decidedByName: string | null;
  refundStatus: string | null;
}

async function actorNameMap(ids: (string | null)[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name] as const));
}

export async function listApprovalQueue(
  store: ApprovalDocStore = prismaApprovalDocStore(),
): Promise<{ config: ApprovalConfig; entries: ApprovalQueueEntry[] }> {
  const [config, doc] = await Promise.all([getApprovalConfig(), readApprovalsDoc(store)]);
  const records = [...doc.records].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const orderIds = [...new Set(records.map((r) => r.orderId))];
  const refundIds = [...new Set(records.map((r) => r.refundId).filter((x): x is string => !!x))];
  const [orders, refunds, names] = await Promise.all([
    orderIds.length
      ? prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, orderNo: true, status: true, customerName: true },
        })
      : Promise.resolve([]),
    refundIds.length
      ? prisma.refund.findMany({ where: { id: { in: refundIds } }, select: { id: true, status: true } })
      : Promise.resolve([]),
    actorNameMap(records.flatMap((r) => [r.requestedById, r.decidedById])),
  ]);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const refundById = new Map(refunds.map((r) => [r.id, r]));
  return {
    config,
    entries: records.map((r) => ({
      ...r,
      orderNo: orderById.get(r.orderId)?.orderNo ?? null,
      orderStatus: orderById.get(r.orderId)?.status ?? null,
      customerName: orderById.get(r.orderId)?.customerName ?? null,
      requestedByName: r.requestedById ? (names.get(r.requestedById) ?? null) : null,
      decidedByName: r.decidedById ? (names.get(r.decidedById) ?? null) : null,
      refundStatus: r.refundId ? (refundById.get(r.refundId)?.status ?? null) : null,
    })),
  };
}

/** Per-order approval state for the order workspace: the latest
 *  discount record (any status) + whether a request is pending now,
 *  and the latest record per refund on this order. */
export interface OrderApprovalState {
  discount: ApprovalRecord | null;
  pendingDiscount: boolean;
  refunds: ApprovalRecord[];
}

export async function getOrderApprovalState(
  orderId: string,
  store: ApprovalDocStore = prismaApprovalDocStore(),
): Promise<OrderApprovalState> {
  const doc = await readApprovalsDoc(store);
  const mine = doc.records
    .filter((r) => r.orderId === orderId)
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  const discount = [...mine].reverse().find((r) => r.kind === "discount") ?? null;
  const byRefund = new Map<string, ApprovalRecord>();
  for (const r of mine) {
    if (r.kind === "refund" && r.refundId) byRefund.set(r.refundId, r);
  }
  return {
    discount,
    pendingDiscount: discount?.status === "PENDING",
    refunds: [...byRefund.values()],
  };
}
