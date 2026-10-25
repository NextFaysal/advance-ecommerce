/**
 * Digital download re-issue flow (doc 18, batch F3) — SERVER ONLY.
 *
 * THE PROBLEM: a DownloadGrant stores only the SHA-256 hash of its
 * bearer token. The raw token exists once, at fulfilment, and is
 * unrecoverable BY DESIGN — so a customer who loses the link, lets it
 * expire (7 days) or exhausts it (5 downloads) used to have NO path,
 * and there was no account surface for downloads at all.
 *
 * THE FLOW built here:
 *  1. The signed-in customer sees their grants in the account
 *     ("আমার ডাউনলোড", GET /api/v1/public/account/downloads) and can
 *     download directly through the session-authorized access path
 *     (accessDownloadGrantById in product-types.ts) — no token
 *     needed, so an ACTIVE grant never needs a re-issue at all.
 *  2. When a grant is expired/exhausted (or the customer says the
 *     link is lost), they file a DownloadReissueRequest (PENDING).
 *     At most one PENDING request per grant: checked here for a
 *     friendly error and enforced by a partial unique index in the
 *     migration as the race-proof backstop.
 *  3. Staff decide in /admin/downloads. APPROVE mints a NEW grant
 *     through the same mintDownloadGrant path fulfilment uses,
 *     revokes the OLD grant (revokedAt — both redemption paths
 *     refuse revoked grants), and records newGrantId on the
 *     request. The new grant's raw token is returned ONCE, in the
 *     approve result, for staff to relay if needed; the customer
 *     can use the account Download button immediately regardless.
 *     REJECT requires a reason (decisionNote).
 *  4. Every decision writes an audit row (downloads.reissue_approve
 *     / downloads.reissue_reject). The token itself is NEVER written
 *     to the audit record.
 *
 * PERMISSIONS (existing keys, no new ones minted): admin reads use
 * products.view, decisions use products.edit — a re-issue decision
 * is a write against a product's digital fulfilment.
 */
import { prisma } from "@advance-ecommerce/db";
import { maskPhone } from "@advance-ecommerce/validators";
import { writeAudit } from "@/lib/audit";
import { mintDownloadGrant } from "./product-types";

/* ------------------------------------------------------------------ */
/* Result convention (mirrors src/orders/returns.ts)                   */
/* ------------------------------------------------------------------ */

export type DownloadAdminResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; error: string };

function fail<T>(code: string, error: string): DownloadAdminResult<T> {
  return { ok: false, code, error };
}

/* ------------------------------------------------------------------ */
/* Grant status (computed — the row stores facts, not a status)        */
/* ------------------------------------------------------------------ */

export type DownloadGrantStatus = "active" | "expired" | "exhausted" | "revoked";

export function grantStatus(grant: {
  revokedAt: Date | null;
  expiresAt: Date;
  downloadsUsed: number;
  maxDownloads: number;
}): DownloadGrantStatus {
  if (grant.revokedAt !== null) return "revoked";
  if (grant.expiresAt.getTime() <= Date.now()) return "expired";
  if (grant.downloadsUsed >= grant.maxDownloads) return "exhausted";
  return "active";
}

export const GRANT_STATUS_LABELS: Record<DownloadGrantStatus, { bn: string; en: string }> = {
  active: { bn: "সক্রিয়", en: "Active" },
  expired: { bn: "মেয়াদ শেষ", en: "Expired" },
  exhausted: { bn: "ডাউনলোড শেষ", en: "Exhausted" },
  revoked: { bn: "বাতিল করা হয়েছে", en: "Revoked" },
};

/* ------------------------------------------------------------------ */
/* Customer side                                                       */
/* ------------------------------------------------------------------ */

export interface CustomerDownloadView {
  grantId: string;
  orderId: string;
  orderNo: string;
  productName: string;
  fileName: string;
  issuedAt: string;
  expiresAt: string;
  maxDownloads: number;
  downloadsUsed: number;
  downloadsLeft: number;
  status: DownloadGrantStatus;
  statusLabel: { bn: string; en: string };
  /** A PENDING re-issue request exists for this grant. */
  reissuePending: boolean;
}

/** Every grant on every order of this customer, newest first. */
export async function listCustomerDownloads(customerId: string): Promise<CustomerDownloadView[]> {
  // DownloadGrant has no Order relation in the schema (orderId is a
  // plain column), so ownership joins through the Order table: first
  // the customer's own orders, then the grants on exactly those.
  const orders = await prisma.order.findMany({
    where: { customerId },
    select: { id: true, orderNo: true },
  });
  if (orders.length === 0) return [];
  const ownOrderNo = new Map(orders.map((o) => [o.id, o.orderNo]));
  const mine = await prisma.downloadGrant.findMany({
    where: { orderId: { in: orders.map((o) => o.id) } },
    select: {
      id: true,
      orderId: true,
      createdAt: true,
      expiresAt: true,
      maxDownloads: true,
      downloadsUsed: true,
      revokedAt: true,
      digitalFile: {
        select: {
          fileName: true,
          product: { select: { titleBn: true, titleEn: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  if (mine.length === 0) return [];

  const pending = await prisma.downloadReissueRequest.findMany({
    where: { grantId: { in: mine.map((r) => r.id) }, status: "PENDING" },
    select: { grantId: true },
  });
  const pendingGrants = new Set(pending.map((p) => p.grantId));

  return mine.map((r) => {
    const status = grantStatus(r);
    return {
      grantId: r.id,
      orderId: r.orderId,
      orderNo: ownOrderNo.get(r.orderId) ?? "",
      productName: r.digitalFile.product.titleBn || r.digitalFile.product.titleEn,
      fileName: r.digitalFile.fileName,
      issuedAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      maxDownloads: r.maxDownloads,
      downloadsUsed: r.downloadsUsed,
      downloadsLeft: Math.max(0, r.maxDownloads - r.downloadsUsed),
      status,
      statusLabel: GRANT_STATUS_LABELS[status],
      reissuePending: pendingGrants.has(r.id),
    };
  });
}

export interface ReissueRequestView {
  id: string;
  grantId: string;
  status: string;
  createdAt: string;
}

/**
 * File a re-issue request for one of the customer's own grants.
 * A grant belonging to another customer answers NOT_FOUND, exactly
 * like an unknown id (the returns self-service convention).
 */
export async function createReissueRequest(input: {
  customerId: string;
  grantId: string;
  reason?: string;
}): Promise<DownloadAdminResult<ReissueRequestView>> {
  const grant = await prisma.downloadGrant.findUnique({
    where: { id: input.grantId },
    select: { id: true, orderId: true },
  });
  if (!grant) return fail("NOT_FOUND", "ডাউনলোডটি পাওয়া যায়নি।");
  const order = await prisma.order.findUnique({
    where: { id: grant.orderId },
    select: { customerId: true },
  });
  if (!order || order.customerId !== input.customerId) {
    return fail("NOT_FOUND", "ডাউনলোডটি পাওয়া যায়নি।");
  }
  const existing = await prisma.downloadReissueRequest.findFirst({
    where: { grantId: grant.id, status: "PENDING" },
    select: { id: true },
  });
  if (existing) {
    return fail(
      "ALREADY_PENDING",
      "এই ডাউনলোডের জন্য ইতিমধ্যে একটি অনুরোধ অপেক্ষমাণ আছে। / A re-issue request is already pending for this download.",
    );
  }
  try {
    const row = await prisma.downloadReissueRequest.create({
      data: {
        grantId: grant.id,
        customerId: input.customerId,
        reason: input.reason?.trim() ? input.reason.trim().slice(0, 500) : null,
        status: "PENDING",
      },
      select: { id: true, grantId: true, status: true, createdAt: true },
    });
    return {
      ok: true,
      value: {
        id: row.id,
        grantId: row.grantId,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      },
    };
  } catch {
    // The partial unique index fired (a racing duplicate) — same
    // honest answer as the pre-check above.
    return fail(
      "ALREADY_PENDING",
      "এই ডাউনলোডের জন্য ইতিমধ্যে একটি অনুরোধ অপেক্ষমাণ আছে। / A re-issue request is already pending for this download.",
    );
  }
}

/* ------------------------------------------------------------------ */
/* Admin side                                                          */
/* ------------------------------------------------------------------ */

export interface ReissueQueueItem {
  id: string;
  grantId: string;
  status: string;
  reason: string | null;
  decisionNote: string | null;
  newGrantId: string | null;
  createdAt: string;
  customerName: string;
  customerPhoneMasked: string;
  orderId: string;
  orderNo: string;
  productName: string;
  fileName: string;
  grantStatus: DownloadGrantStatus;
  grantExpiresAt: string;
  grantDownloadsUsed: number;
  grantMaxDownloads: number;
}

export async function listReissueRequests(input: {
  status?: string;
  page: number;
  pageSize: number;
}): Promise<{ requests: ReissueQueueItem[]; total: number; counts: Record<string, number> }> {
  const page = Math.max(1, input.page);
  const pageSize = Math.min(100, Math.max(1, input.pageSize));
  const where = input.status
    ? { status: input.status as "PENDING" | "APPROVED" | "REJECTED" }
    : {};
  const [total, grouped, rows] = await Promise.all([
    prisma.downloadReissueRequest.count({ where }),
    prisma.downloadReissueRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.downloadReissueRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        grantId: true,
        status: true,
        reason: true,
        decisionNote: true,
        newGrantId: true,
        createdAt: true,
        customer: { select: { name: true, phone: true } },
        grant: {
          select: {
            orderId: true,
            expiresAt: true,
            downloadsUsed: true,
            maxDownloads: true,
            revokedAt: true,
            digitalFile: {
              select: {
                fileName: true,
                product: { select: { titleBn: true, titleEn: true } },
              },
            },
          },
        },
      },
    }),
  ]);
  const counts: Record<string, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
  for (const g of grouped) counts[g.status] = g._count._all;

  const orderIds = [...new Set(rows.map((r) => r.grant.orderId))];
  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, orderNo: true },
  });
  const orderNoById = new Map(orders.map((o) => [o.id, o.orderNo]));

  return {
    total,
    counts,
    requests: rows.map((r) => ({
      id: r.id,
      grantId: r.grantId,
      status: r.status,
      reason: r.reason,
      decisionNote: r.decisionNote,
      newGrantId: r.newGrantId,
      createdAt: r.createdAt.toISOString(),
      customerName: r.customer.name,
      customerPhoneMasked: maskPhone(r.customer.phone),
      orderId: r.grant.orderId,
      orderNo: orderNoById.get(r.grant.orderId) ?? "",
      productName: r.grant.digitalFile.product.titleBn || r.grant.digitalFile.product.titleEn,
      fileName: r.grant.digitalFile.fileName,
      grantStatus: grantStatus(r.grant),
      grantExpiresAt: r.grant.expiresAt.toISOString(),
      grantDownloadsUsed: r.grant.downloadsUsed,
      grantMaxDownloads: r.grant.maxDownloads,
    })),
  };
}

export interface OrderGrantView {
  grantId: string;
  orderItemId: string;
  fileName: string;
  productName: string;
  issuedAt: string;
  expiresAt: string;
  downloadsUsed: number;
  maxDownloads: number;
  status: DownloadGrantStatus;
  reissuePending: boolean;
}

/** Grant lookup by order (id or order number) for the admin page. */
export async function getOrderDownloadGrants(
  orderRef: string,
): Promise<DownloadAdminResult<{ orderId: string; orderNo: string; grants: OrderGrantView[] }>> {
  const order = await prisma.order.findFirst({
    where: { OR: [{ id: orderRef }, { orderNo: orderRef }] },
    select: { id: true, orderNo: true },
  });
  if (!order) return fail("ORDER_NOT_FOUND", "অর্ডারটি পাওয়া যায়নি। / Order not found.");
  const rows = await prisma.downloadGrant.findMany({
    where: { orderId: order.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      orderItemId: true,
      createdAt: true,
      expiresAt: true,
      downloadsUsed: true,
      maxDownloads: true,
      revokedAt: true,
      digitalFile: {
        select: {
          fileName: true,
          product: { select: { titleBn: true, titleEn: true } },
        },
      },
    },
  });
  const pending = await prisma.downloadReissueRequest.findMany({
    where: { grantId: { in: rows.map((r) => r.id) }, status: "PENDING" },
    select: { grantId: true },
  });
  const pendingGrants = new Set(pending.map((p) => p.grantId));
  return {
    ok: true,
    value: {
      orderId: order.id,
      orderNo: order.orderNo,
      grants: rows.map((r) => ({
        grantId: r.id,
        orderItemId: r.orderItemId,
        fileName: r.digitalFile.fileName,
        productName: r.digitalFile.product.titleBn || r.digitalFile.product.titleEn,
        issuedAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        downloadsUsed: r.downloadsUsed,
        maxDownloads: r.maxDownloads,
        status: grantStatus(r),
        reissuePending: pendingGrants.has(r.id),
      })),
    },
  };
}

export interface ApproveReissueValue {
  requestId: string;
  status: string;
  oldGrantId: string;
  newGrantId: string;
  fileName: string;
  expiresAt: string;
  /**
   * The new grant's one-time download PATH (token included). This is
   * the ONLY place the raw token ever surfaces after minting — the
   * approve response, for staff to relay if needed. It is never
   * stored and never written to the audit log.
   */
  downloadPath: string;
}

/**
 * Approve a PENDING re-issue request: mint the replacement grant,
 * revoke the old grant, record the link — one transaction for the
 * data, then the audit row. The guarded status flip (PENDING only)
 * makes a double-approve mint exactly one replacement.
 */
export async function approveReissueRequest(input: {
  requestId: string;
  adminId: string;
  note?: string;
}): Promise<DownloadAdminResult<ApproveReissueValue>> {
  const request = await prisma.downloadReissueRequest.findUnique({
    where: { id: input.requestId },
    select: {
      id: true,
      status: true,
      grant: {
        select: {
          id: true,
          orderId: true,
          orderItemId: true,
          digitalFileId: true,
          revokedAt: true,
          digitalFile: { select: { fileName: true } },
        },
      },
    },
  });
  if (!request) return fail("NOT_FOUND", "অনুরোধটি পাওয়া যায়নি। / Request not found.");
  if (request.status !== "PENDING") {
    return fail("INVALID_STATE", "এই অনুরোধের সিদ্ধান্ত ইতিমধ্যে নেওয়া হয়েছে। / This request was already decided.");
  }
  const note = input.note?.trim() ? input.note.trim().slice(0, 1000) : null;

  const minted = await prisma.$transaction(async (tx) => {
    const flipped = await tx.downloadReissueRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: "APPROVED", decidedById: input.adminId, decisionNote: note },
    });
    if (flipped.count === 0) return null;
    const fresh = await mintDownloadGrant(tx, {
      orderId: request.grant.orderId,
      orderItemId: request.grant.orderItemId,
      digitalFileId: request.grant.digitalFileId,
    });
    if (request.grant.revokedAt === null) {
      await tx.downloadGrant.update({
        where: { id: request.grant.id },
        data: { revokedAt: new Date() },
      });
    }
    await tx.downloadReissueRequest.update({
      where: { id: request.id },
      data: { newGrantId: fresh.id },
    });
    return fresh;
  });
  if (minted === null) {
    return fail("INVALID_STATE", "এই অনুরোধের সিদ্ধান্ত ইতিমধ্যে নেওয়া হয়েছে। / This request was already decided.");
  }

  await writeAudit({
    actorId: input.adminId,
    action: "downloads.reissue_approve",
    entityType: "DownloadReissueRequest",
    entityId: request.id,
    beforeJson: { status: "PENDING", grantId: request.grant.id },
    afterJson: { status: "APPROVED", newGrantId: minted.id, oldGrantRevoked: true },
    reason: note ?? undefined,
  });

  return {
    ok: true,
    value: {
      requestId: request.id,
      status: "APPROVED",
      oldGrantId: request.grant.id,
      newGrantId: minted.id,
      fileName: request.grant.digitalFile.fileName,
      expiresAt: minted.expiresAt.toISOString(),
      downloadPath: `/api/v1/public/download/${minted.token}`,
    },
  };
}

/** Reject a PENDING re-issue request — a reason is required. */
export async function rejectReissueRequest(input: {
  requestId: string;
  adminId: string;
  note?: string;
}): Promise<DownloadAdminResult<{ requestId: string; status: string }>> {
  const note = input.note?.trim() ? input.note.trim().slice(0, 1000) : null;
  if (note === null) {
    return fail("REASON_REQUIRED", "বাতিলের কারণ লিখতে হবে। / A reason is required to reject.");
  }
  const request = await prisma.downloadReissueRequest.findUnique({
    where: { id: input.requestId },
    select: { id: true, status: true, grantId: true },
  });
  if (!request) return fail("NOT_FOUND", "অনুরোধটি পাওয়া যায়নি। / Request not found.");
  if (request.status !== "PENDING") {
    return fail("INVALID_STATE", "এই অনুরোধের সিদ্ধান্ত ইতিমধ্যে নেওয়া হয়েছে। / This request was already decided.");
  }
  const flipped = await prisma.downloadReissueRequest.updateMany({
    where: { id: request.id, status: "PENDING" },
    data: { status: "REJECTED", decidedById: input.adminId, decisionNote: note },
  });
  if (flipped.count === 0) {
    return fail("INVALID_STATE", "এই অনুরোধের সিদ্ধান্ত ইতিমধ্যে নেওয়া হয়েছে। / This request was already decided.");
  }
  await writeAudit({
    actorId: input.adminId,
    action: "downloads.reissue_reject",
    entityType: "DownloadReissueRequest",
    entityId: request.id,
    beforeJson: { status: "PENDING", grantId: request.grantId },
    afterJson: { status: "REJECTED" },
    reason: note,
  });
  return { ok: true, value: { requestId: request.id, status: "REJECTED" } };
}
