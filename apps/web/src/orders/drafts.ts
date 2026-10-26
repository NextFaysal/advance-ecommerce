/**
 * Draft orders (doc 17 batch O9-2) — park a half-built manual order
 * and come back to it. A DraftOrder is NOT an order:
 *
 *   - it takes NO order number and appears in NO order list/report;
 *   - it reserves NO stock and runs NO fraud/coupon evaluation;
 *   - its payload is a ManualCreateInput-SHAPED JSON document that
 *     may be PARTIAL (missing address fields, no items yet) — saving
 *     is deliberately lenient, because a draft exists precisely when
 *     the form could not be finished.
 *
 * RE-PRICING RULE (the contract that makes drafts safe): the stored
 * payload is never trusted as priced truth. Conversion re-runs the
 * payload through createManualOrder (src/orders/manual-create),
 * which re-validates every variant + price at conversion time
 * exactly like a fresh manual create — catalog/staff per-line prices
 * stored in the payload are honoured the way manual-create honours
 * them (staff prices are a feature of the channel and are recorded on
 * the order note when they differ from catalog), shipping/coupon/
 * fraud/advance are all recomputed server-side, and the delivery
 * slot id is re-resolved against the configured set. The
 * totalPreviewPoisha stored on the draft is a save-time ESTIMATE for
 * the drafts list — refreshed on every save, never a commitment.
 *
 * Conversion is idempotent: a CONVERTED draft returns its linked
 * order; the claim (OPEN -> CONVERTED) happens before the create so
 * two staff converting at once cannot mint two orders — a failed
 * create reverts the claim to OPEN (and a CONVERTED draft with no
 * linked order, e.g. after a crash mid-conversion, is reverted and
 * retried on the next convert call).
 */
import { prisma } from "@advance-ecommerce/db";
import { writeAudit } from "@/lib/audit";
import { getVariantSnapshots, getOrderByIdOrNo } from "@/orders/repository";
import {
  createManualOrder,
  type ManualCreatePricing,
  type ManualOrderActor,
} from "@/orders/manual-create";
import { manualShippingPoisha, type ManualShippingMethod } from "@/orders/manual-order";
import { isValidQtyNumber, lineTotalPoisha } from "../lib/quantity";
import type { Order } from "@/orders/types";

/** Drafts are staff-only: the actor must be a real user (the widened
 *  ManualOrderActor also admits the null-id system actor used by the
 *  subscription generator, which never creates drafts). */
export type DraftActor = ManualOrderActor & { id: string };

export interface DraftOrderView {
  id: string;
  /** The stored ManualCreateInput-shaped payload (possibly partial). */
  payload: Record<string, unknown>;
  customerName: string | null;
  customerPhone: string | null;
  /** Save-time price estimate (poisha); null when it cannot be priced. */
  totalPreviewPoisha: number | null;
  itemCount: number;
  status: "OPEN" | "CONVERTED" | "DISCARDED";
  convertedOrderId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

type DraftRow = Awaited<ReturnType<typeof findDraftRow>>;
async function findDraftRow(id: string) {
  return prisma.draftOrder.findUnique({ where: { id } });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function looseString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function payloadItems(payload: Record<string, unknown>): Array<{
  variantId: string;
  quantity: number;
  unitPricePoisha?: number;
}> {
  const raw = payload.items;
  if (!Array.isArray(raw)) return [];
  const items: Array<{ variantId: string; quantity: number; unitPricePoisha?: number }> = [];
  for (const entry of raw) {
    const rec = asRecord(entry);
    if (!rec || typeof rec.variantId !== "string" || rec.variantId === "") continue;
    // Wave 59: draft payloads may carry fractional quantities for
    // weighted variants (conversion re-gates them in createManualOrder).
    const quantity = isValidQtyNumber(rec.quantity) ? rec.quantity : 1;
    const unitPricePoisha =
      typeof rec.unitPricePoisha === "number" &&
      Number.isInteger(rec.unitPricePoisha) &&
      rec.unitPricePoisha >= 0
        ? rec.unitPricePoisha
        : undefined;
    items.push({ variantId: rec.variantId, quantity, ...(unitPricePoisha !== undefined ? { unitPricePoisha } : {}) });
  }
  return items;
}

function toView(row: NonNullable<DraftRow>): DraftOrderView {
  const payload = asRecord(row.payloadJson) ?? {};
  return {
    id: row.id,
    payload,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    totalPreviewPoisha: row.totalPreviewPoisha,
    itemCount: payloadItems(payload).length,
    status: row.status,
    convertedOrderId: row.convertedOrderId,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Save-time preview total: Σ lines (staff per-line price when the
 * payload carries one, else the CURRENT catalog price) + the
 * delivery charge the builder would show (staff override when set,
 * else the method rate at the shipping engine's default rates).
 * Null when any line's variant no longer resolves — the draft still
 * saves; conversion is where an unresolvable line honestly fails.
 */
export async function computeDraftPreviewPoisha(payload: unknown): Promise<number | null> {
  const rec = asRecord(payload);
  if (!rec) return null;
  const items = payloadItems(rec);
  let subtotalPoisha = 0;
  if (items.length > 0) {
    const snapshots = await getVariantSnapshots(items.map((i) => i.variantId));
    for (const item of items) {
      const server = snapshots.get(item.variantId);
      if (!server) return null;
      subtotalPoisha += lineTotalPoisha(item.unitPricePoisha ?? server.unitPricePoisha, item.quantity);
    }
  }
  const override =
    typeof rec.shippingOverridePoisha === "number" &&
    Number.isInteger(rec.shippingOverridePoisha) &&
    rec.shippingOverridePoisha >= 0
      ? rec.shippingOverridePoisha
      : null;
  const method: ManualShippingMethod =
    rec.shippingMethod === "outside_dhaka" || rec.shippingMethod === "pickup"
      ? rec.shippingMethod
      : "inside_dhaka";
  return subtotalPoisha + (override ?? manualShippingPoisha(method));
}

export type SaveDraftResult =
  | { ok: true; draft: DraftOrderView }
  | { ok: false; httpStatus: number; code: string; message: string };

/** Create a draft, or update an OPEN one in place when `id` is given. */
export async function saveDraftOrder(
  input: { id?: string; payload: unknown },
  actor: DraftActor,
): Promise<SaveDraftResult> {
  const payload = asRecord(input.payload);
  if (!payload) {
    return {
      ok: false,
      httpStatus: 400,
      code: "VALIDATION_ERROR",
      message: "ড্রাফটের payload একটি JSON object হতে হবে। / Draft payload must be a JSON object.",
    };
  }
  const customerName = looseString(payload.customerName);
  const customerPhone = looseString(payload.phone) ?? looseString(payload.customerPhone);
  const totalPreviewPoisha = await computeDraftPreviewPoisha(payload);
  // JSON round-trip: stores a plain, JSON-safe copy (and detaches the
  // draft from the caller's object) — the same cast the cash-closing
  // route uses for its Json column.
  const payloadJson = JSON.parse(JSON.stringify(payload)) as never;

  if (input.id) {
    const existing = await findDraftRow(input.id);
    if (!existing) {
      return { ok: false, httpStatus: 404, code: "NOT_FOUND", message: "ড্রাফট পাওয়া যায়নি। / Draft not found." };
    }
    if (existing.status !== "OPEN") {
      return {
        ok: false,
        httpStatus: 409,
        code: "DRAFT_NOT_OPEN",
        message: "শুধু খোলা (OPEN) ড্রাফট সম্পাদনা করা যায়। / Only an OPEN draft can be edited.",
      };
    }
    const row = await prisma.draftOrder.update({
      where: { id: input.id },
      data: { payloadJson, customerName, customerPhone, totalPreviewPoisha },
    });
    await writeAudit({
      actorId: actor.id,
      action: "orders.draft_save",
      entityType: "DraftOrder",
      entityId: row.id,
      afterJson: { created: false, totalPreviewPoisha, itemCount: payloadItems(payload).length },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return { ok: true, draft: toView(row) };
  }

  const row = await prisma.draftOrder.create({
    data: { payloadJson, customerName, customerPhone, totalPreviewPoisha, createdById: actor.id },
  });
  await writeAudit({
    actorId: actor.id,
    action: "orders.draft_save",
    entityType: "DraftOrder",
    entityId: row.id,
    afterJson: { created: true, totalPreviewPoisha, itemCount: payloadItems(payload).length },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return { ok: true, draft: toView(row) };
}

/** Draft list: OPEN first (enum declaration order), then most
 *  recently touched. Capped at 100 rows — a drafts strip is a work
 *  queue, not an archive browser. */
export async function listDraftOrders(): Promise<DraftOrderView[]> {
  const rows = await prisma.draftOrder.findMany({
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 100,
  });
  return rows.map(toView);
}

export async function getDraftOrder(id: string): Promise<DraftOrderView | null> {
  const row = await findDraftRow(id);
  return row ? toView(row) : null;
}

export type DiscardDraftResult =
  | { ok: true; draft: DraftOrderView }
  | { ok: false; httpStatus: number; code: string; message: string };

/** OPEN -> DISCARDED. Discarding an already-discarded draft is a
 *  no-op success; a CONVERTED draft is history and refuses. */
export async function discardDraftOrder(id: string, actor: DraftActor): Promise<DiscardDraftResult> {
  const row = await findDraftRow(id);
  if (!row) {
    return { ok: false, httpStatus: 404, code: "NOT_FOUND", message: "ড্রাফট পাওয়া যায়নি। / Draft not found." };
  }
  if (row.status === "CONVERTED") {
    return {
      ok: false,
      httpStatus: 409,
      code: "DRAFT_ALREADY_CONVERTED",
      message: "রূপান্তরিত ড্রাফট বাতিল করা যায় না — এটি একটি আসল অর্ডারে পরিণত হয়েছে। / A converted draft cannot be discarded; it is a real order now.",
    };
  }
  if (row.status === "DISCARDED") return { ok: true, draft: toView(row) };
  const updated = await prisma.draftOrder.update({ where: { id }, data: { status: "DISCARDED" } });
  await writeAudit({
    actorId: actor.id,
    action: "orders.draft_discard",
    entityType: "DraftOrder",
    entityId: id,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return { ok: true, draft: toView(updated) };
}

export type ConvertDraftResult =
  | {
      ok: true;
      /** True when the draft was already converted — the linked order
       *  is returned, nothing was created. */
      replayed: boolean;
      draft: DraftOrderView;
      order: Order | null;
      orderId: string;
      orderNo: string;
      pricing: ManualCreatePricing | null;
    }
  | { ok: false; httpStatus: number; code: string; message: string; details?: unknown };

/**
 * Convert a draft into a real order by re-running its payload
 * through createManualOrder (see the re-pricing rule in the header).
 * A create failure leaves the draft OPEN with the failure surfaced
 * verbatim, so staff can fix the form (Resume) and retry.
 */
export async function convertDraftOrder(
  id: string,
  actor: ManualOrderActor,
): Promise<ConvertDraftResult> {
  const row = await findDraftRow(id);
  if (!row) {
    return { ok: false, httpStatus: 404, code: "NOT_FOUND", message: "ড্রাফট পাওয়া যায়নি। / Draft not found." };
  }
  if (row.status === "DISCARDED") {
    return {
      ok: false,
      httpStatus: 409,
      code: "DRAFT_DISCARDED",
      message: "বাতিল করা ড্রাফট অর্ডারে রূপান্তর করা যায় না। / A discarded draft cannot be converted.",
    };
  }
  if (row.status === "CONVERTED" && row.convertedOrderId) {
    const order = await getOrderByIdOrNo(row.convertedOrderId);
    return {
      ok: true,
      replayed: true,
      draft: toView(row),
      order,
      orderId: row.convertedOrderId,
      orderNo: order?.orderNo ?? "",
      pricing: null,
    };
  }

  // Claim first (OPEN -> CONVERTED, or recover a CONVERTED row whose
  // link was never written) so a concurrent convert cannot mint a
  // second order. The create failure path reverts the claim.
  const claim = await prisma.draftOrder.updateMany({
    where: {
      id,
      OR: [{ status: "OPEN" }, { status: "CONVERTED", convertedOrderId: null }],
    },
    data: { status: "CONVERTED" },
  });
  if (claim.count === 0) {
    // Lost the race: the winner's link may not be written yet, so
    // report a conflict the caller can retry rather than guessing.
    return {
      ok: false,
      httpStatus: 409,
      code: "DRAFT_CONVERT_IN_PROGRESS",
      message: "এই ড্রাফটটি এখনই অন্য কেউ রূপান্তর করছেন — একটু পরে আবার চেষ্টা করুন। / This draft is being converted right now — please retry in a moment.",
    };
  }

  const payload = asRecord(row.payloadJson) ?? {};
  const created = await createManualOrder(payload as never, actor);
  if (!created.ok) {
    await prisma.draftOrder.updateMany({
      where: { id, status: "CONVERTED", convertedOrderId: null },
      data: { status: "OPEN" },
    });
    return {
      ok: false,
      httpStatus: created.httpStatus,
      code: created.code,
      message: created.message,
      details: created.details,
    };
  }

  const linked = await prisma.draftOrder.update({
    where: { id },
    data: { status: "CONVERTED", convertedOrderId: created.orderId },
  });
  await writeAudit({
    actorId: actor.id,
    action: "orders.draft_convert",
    entityType: "DraftOrder",
    entityId: id,
    afterJson: { orderId: created.orderId, orderNo: created.orderNo, replayedCreate: created.replayed },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return {
    ok: true,
    replayed: false,
    draft: toView(linked),
    order: created.order,
    orderId: created.orderId,
    orderNo: created.orderNo,
    pricing: created.pricing,
  };
}
