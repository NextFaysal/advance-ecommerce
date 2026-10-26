/**
 * Pharmacy prescription flow — ADV-22 wiring (doc 22).
 *
 * What "prescription" means here, honestly: storage uploads are
 * gated on merchant R2/S3 credentials (STORAGE_NOT_CONFIGURED until
 * then), so checkout collects a prescription RECORD — the customer
 * attests they hold a valid prescription and records the prescriber
 * name + registration number, plus an image URL when they already
 * have one hosted. This module NEVER claims the prescription was
 * verified: verification is the pharmacist's decision in the review
 * queue below, recorded as a decision on the order.
 *
 * Persistence (no schema change):
 *  - The record rides the order's create-time note (the ADV-19
 *    pickup-marker seam): human bilingual lines + one machine line
 *    `[rx-record] {json}` that parsePrescriptionRecord reads back.
 *  - Review state rides OrderTag rows — append-only like the rest of
 *    the order timeline: "rx:pending" at create (when review is
 *    required), then "rx:approved" / "rx:rejected" at decision time.
 *    The LATEST rx tag is the state.
 *
 * Confirm block: while the state is PENDING (or REJECTED — a rejected
 * prescription must end in cancellation by staff, never in a silent
 * confirm), the PENDING → CONFIRMED transition is refused through
 * applyOrderTransition's gate (src/orders/repository.ts), the same
 * funnel the advance/OTP gate uses — so every confirm path (admin
 * PATCH, call-center outcome, one-click flow) is covered.
 */
import { qtyNumber } from "../lib/quantity";
import { productRequiresPrescription, validatePharmacyCheckout, type PharmacyConfig } from "./pharmacy";
import { getSavedPackConfig } from "./config-store";
import { isPackEnabled } from "./packs";

export const RX_TAG_PENDING = "rx:pending";
export const RX_TAG_APPROVED = "rx:approved";
export const RX_TAG_REJECTED = "rx:rejected";
const RX_TAGS = [RX_TAG_PENDING, RX_TAG_APPROVED, RX_TAG_REJECTED] as const;

export type RxReviewState = "PENDING" | "APPROVED" | "REJECTED";

export interface PrescriptionRecord {
  prescriberName: string;
  registrationNo: string;
  /** Optional URL of a prescription image the customer already hosts. */
  imageUrl?: string | null;
  /** The customer attested they hold this prescription. Always true — zod enforces it at checkout. */
  attested: true;
}

export class RxReviewError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function loadPharmacyConfig(): Promise<PharmacyConfig> {
  const { config } = await getSavedPackConfig("pharmacy");
  return config as PharmacyConfig;
}

/* ------------------------------------------------------------------ */
/* Which variants need a prescription                                  */
/* ------------------------------------------------------------------ */

/** variantId → requiresPrescription, from the owning products' tags. */
export async function getVariantRxMap(
  variantIds: readonly string[],
  config?: PharmacyConfig,
): Promise<Map<string, boolean>> {
  const cfg = config ?? (await loadPharmacyConfig());
  const map = new Map<string, boolean>();
  if (variantIds.length === 0) return map;
  const { prisma } = await import("@advance-ecommerce/db");
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: [...variantIds] }, deletedAt: null },
    select: { id: true, product: { select: { tags: true } } },
  });
  for (const v of variants) map.set(v.id, productRequiresPrescription(cfg, v.product.tags));
  return map;
}

/** The pack's own checkout gate, fed with this module's record shape. */
export function checkPrescriptionGate(
  items: Array<{ variantId: string; requiresPrescription: boolean }>,
  record: PrescriptionRecord | null,
): { ok: true } | { ok: false; errors: Array<{ field: string; message: string }> } {
  const ref = record ? `rx:${record.registrationNo}` : null;
  const result = validatePharmacyCheckout(items, ref);
  return result.ok ? { ok: true } : { ok: false, errors: result.errors };
}

export function orderHasRxItems(rxMap: Map<string, boolean>, variantIds: readonly string[]): boolean {
  return variantIds.some((id) => rxMap.get(id) === true);
}

/* ------------------------------------------------------------------ */
/* The prescription record on the order note                           */
/* ------------------------------------------------------------------ */

const RX_RECORD_MARKER = "[rx-record]";

export function prescriptionNoteText(record: PrescriptionRecord): string {
  const lines = [
    `প্রেসক্রিপশন রেকর্ড / Prescription record — চিকিৎসক / Prescriber: ${record.prescriberName} · রেজিস্ট্রেশন নং / Registration no: ${record.registrationNo}`,
    "গ্রাহক নিশ্চিত করেছেন যে তাঁর কাছে এই প্রেসক্রিপশনটি আছে / The customer attested they hold this prescription. ফার্মাসিস্টের যাচাই বাকি / Pharmacist verification is pending — এই রেকর্ডটি যাচাইকৃত প্রেসক্রিপশন নয় / this record is NOT a verified prescription.",
  ];
  if (record.imageUrl) lines.push(`প্রেসক্রিপশনের ছবি / Prescription image: ${record.imageUrl}`);
  lines.push(`${RX_RECORD_MARKER} ${JSON.stringify(record)}`);
  return lines.join("\n");
}

/** Read the record back from an order's notes (latest marker wins). */
export function parsePrescriptionRecord(noteTexts: readonly string[]): PrescriptionRecord | null {
  for (let i = noteTexts.length - 1; i >= 0; i--) {
    const text = noteTexts[i] ?? "";
    const idx = text.lastIndexOf(RX_RECORD_MARKER);
    if (idx === -1) continue;
    try {
      const parsed = JSON.parse(text.slice(idx + RX_RECORD_MARKER.length).trim()) as PrescriptionRecord;
      if (parsed && typeof parsed.prescriberName === "string" && typeof parsed.registrationNo === "string") {
        return parsed;
      }
    } catch {
      // A malformed marker is not a record — keep scanning older notes.
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Review state (OrderTag, append-only)                                */
/* ------------------------------------------------------------------ */

function stateFromTag(tag: string): RxReviewState {
  if (tag === RX_TAG_APPROVED) return "APPROVED";
  if (tag === RX_TAG_REJECTED) return "REJECTED";
  return "PENDING";
}

/** Latest rx tag decides. Null = the order never entered the Rx flow. */
export async function getRxReviewState(orderId: string): Promise<RxReviewState | null> {
  const { prisma } = await import("@advance-ecommerce/db");
  const row = await prisma.orderTag.findFirst({
    where: { orderId, tag: { in: [...RX_TAGS] } },
    orderBy: { createdAt: "desc" },
    select: { tag: true },
  });
  return row ? stateFromTag(row.tag) : null;
}

/** Stamp an order into the review queue (idempotent: only when stateless). */
export async function tagOrderRxPending(orderId: string): Promise<void> {
  const { prisma } = await import("@advance-ecommerce/db");
  const existing = await prisma.orderTag.findFirst({
    where: { orderId, tag: { in: [...RX_TAGS] } },
    select: { id: true },
  });
  if (existing) return;
  await prisma.orderTag.create({ data: { orderId, tag: RX_TAG_PENDING } });
}

/**
 * The confirm gate's Rx half — called by applyOrderTransition for
 * PENDING → CONFIRMED only. Returns a block or null. Cheap exit when
 * the pack is off or review is not required; the state read is one
 * indexed query.
 */
export async function rxConfirmBlock(
  orderId: string,
): Promise<{ code: "RX_NOT_APPROVED"; message: string } | null> {
  if (!isPackEnabled("pharmacy")) return null;
  const config = await loadPharmacyConfig();
  if (!config.pharmacistReviewRequired) return null;
  const state = await getRxReviewState(orderId);
  if (state === "PENDING") {
    return {
      code: "RX_NOT_APPROVED",
      message:
        "এই অর্ডারে প্রেসক্রিপশন-আবশ্যক পণ্য আছে — ফার্মাসিস্টের অনুমোদন ছাড়া নিশ্চিত করা যাবে না। / This order contains prescription-required items — it cannot be confirmed before pharmacist approval.",
    };
  }
  if (state === "REJECTED") {
    return {
      code: "RX_NOT_APPROVED",
      message:
        "এই অর্ডারের প্রেসক্রিপশন ফার্মাসিস্ট বাতিল করেছেন — অর্ডারটি নিশ্চিত করা যাবে না; প্রয়োজনে বাতিল করুন। / The prescription for this order was rejected by the pharmacist — it cannot be confirmed; cancel it if needed.",
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Pharmacist verification queue                                       */
/* ------------------------------------------------------------------ */

export interface RxQueueRow {
  orderId: string;
  orderNo: string;
  status: string;
  customerName: string;
  customerPhone: string;
  createdAt: string;
  totalPoisha: number;
  rxItems: Array<{ productName: string; sku: string; quantity: number }>;
  prescription: PrescriptionRecord | null;
  queuedAt: string;
}

/** Orders whose LATEST rx state is PENDING, oldest first. */
export async function listRxQueue(): Promise<RxQueueRow[]> {
  const { prisma } = await import("@advance-ecommerce/db");
  const pendingTags = await prisma.orderTag.findMany({
    where: { tag: RX_TAG_PENDING },
    orderBy: { createdAt: "asc" },
    select: { orderId: true, createdAt: true },
  });
  if (pendingTags.length === 0) return [];
  const orderIds = [...new Set(pendingTags.map((t) => t.orderId))];
  const allRxTags = await prisma.orderTag.findMany({
    where: { orderId: { in: orderIds }, tag: { in: [...RX_TAGS] } },
    orderBy: { createdAt: "desc" },
    select: { orderId: true, tag: true },
  });
  const latestByOrder = new Map<string, string>();
  for (const t of allRxTags) {
    if (!latestByOrder.has(t.orderId)) latestByOrder.set(t.orderId, t.tag);
  }
  const stillPending = orderIds.filter((id) => latestByOrder.get(id) === RX_TAG_PENDING);
  if (stillPending.length === 0) return [];

  const orders = await prisma.order.findMany({
    where: { id: { in: stillPending }, deletedAt: null },
    include: {
      items: { select: { productName: true, sku: true, quantity: true, variantId: true } },
      notes: { orderBy: { createdAt: "asc" }, select: { text: true } },
    },
  });
  const rxMap = await getVariantRxMap(orders.flatMap((o) => o.items.map((i) => i.variantId)));
  const queuedAtByOrder = new Map(pendingTags.map((t) => [t.orderId, t.createdAt]));
  return orders
    .map((o) => ({
      orderId: o.id,
      orderNo: o.orderNo,
      status: o.status,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      createdAt: o.createdAt.toISOString(),
      totalPoisha: o.totalPoisha,
      rxItems: o.items
        .filter((i) => rxMap.get(i.variantId) === true)
        .map((i) => ({ productName: i.productName, sku: i.sku, quantity: qtyNumber(i.quantity) })),
      prescription: parsePrescriptionRecord(o.notes.map((n) => n.text)),
      queuedAt: (queuedAtByOrder.get(o.id) ?? o.createdAt).toISOString(),
    }))
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

/**
 * Record the pharmacist's decision: a new rx tag (the state) + a
 * timeline note (the human record). REJECTED does not cancel the
 * order here — cancellation stays a deliberate staff action through
 * the normal flow (stock/money funnels); the confirm block above
 * guarantees a rejected order can never slip through meanwhile.
 */
export async function decideRxReview(input: {
  orderId: string;
  decision: "APPROVED" | "REJECTED";
  note: string;
  actorId: string;
}): Promise<{ state: RxReviewState }> {
  const { prisma } = await import("@advance-ecommerce/db");
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, deletedAt: null },
    select: { id: true, orderNo: true },
  });
  if (!order) throw new RxReviewError("ORDER_NOT_FOUND", "Order not found.");
  const state = await getRxReviewState(input.orderId);
  if (state !== "PENDING") {
    throw new RxReviewError(
      "RX_NOT_PENDING",
      `This order is not waiting for prescription review (state: ${state ?? "none"}).`,
    );
  }
  const tag = input.decision === "APPROVED" ? RX_TAG_APPROVED : RX_TAG_REJECTED;
  const noteText =
    input.decision === "APPROVED"
      ? `প্রেসক্রিপশন অনুমোদিত / Prescription approved by pharmacist — মন্তব্য / Note: ${input.note}`
      : `প্রেসক্রিপশন বাতিল / Prescription REJECTED by pharmacist — মন্তব্য / Note: ${input.note}. অর্ডার নিশ্চিত করা যাবে না / The order cannot be confirmed.`;
  await prisma.$transaction(async (tx) => {
    await tx.orderTag.create({ data: { orderId: input.orderId, tag } });
    await tx.orderNote.create({
      data: { orderId: input.orderId, authorId: input.actorId, text: noteText },
    });
  });
  return { state: input.decision };
}
