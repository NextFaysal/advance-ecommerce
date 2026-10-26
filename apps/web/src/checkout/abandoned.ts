/**
 * Abandoned-checkout capture + recovery (wave 22, doc 17 batch O4).
 *
 * The storefront checkout posts a snapshot here once the shopper has
 * typed a VALID BD phone and has items in the cart (debounced, plus a
 * pagehide send) — POST /api/v1/public/checkout/capture. Before this
 * batch nothing was captured at all: the cart lived only in the
 * browser, so a shopper who left was simply gone.
 *
 * Privacy / honesty rules baked in:
 * - Prices are snapshotted from the CATALOG server-side at capture
 *   time. The client sends only variant ids + quantities; any price
 *   it claims is ignored.
 * - The full phone number lives ONLY in the DB row (and, when staff
 *   create a call task, on that CallTask — the same server-side-only
 *   persistence MANUAL call tasks use). Every admin read masks it.
 * - There is deliberately NO public read endpoint for captures.
 * - A capture closes forever once RECOVERED or DISMISSED: a repeated
 *   capture with the same sessionKey never resurrects it (a returning
 *   shopper gets a NEW sessionKey only when sessionStorage is gone —
 *   starting a genuinely new capture).
 * - Conversion RE-PRICES from the live catalog and reserves stock
 *   through createOrderRecord, exactly like a staff manual order
 *   (source "manual" + an internal note naming the capture).
 */
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { ContactRateLimiter } from "../contact/policy";
import { priorityForSource } from "../callcenter/queue";
import {
  BundleStockError,
  PreorderCapError,
  productTypesEnabledInDb,
} from "../catalog/product-types";
import {
  ADVANCE_REASON_LABELS,
  percentAdvancePoisha,
  pickAdvanceRequirement,
  type AdvanceCandidate,
} from "../orders/advance";
import { publishOrderCreated } from "../orders/event-bus";
import { emitAutomationEvent } from "../automation/producers";
import {
  createOrderRecord,
  findOrderByIdempotencyKey,
  getVariantSnapshots,
  listOrdersByPhone,
  orderRowToEnriched,
} from "../orders/repository";
import type { Order } from "../orders/types";
import { scoreFraud } from "../fraud/scoring";
import { loadOrderRules } from "./order-rules";
import {
  assembleFraudInput,
  fraudEnforcement,
} from "./order-enrichment";
import { computePricing } from "./pricing";
import { computeOrderShipping } from "./shipping";
import { maskPhone, normalizeBdPhone, type BdAddress } from "./validation";

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/** Typed failure the API routes map straight onto an HTTP response. */
export class AbandonedError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AbandonedError";
  }
}

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export interface CapturedItem {
  variantId: string;
  quantity: number;
  /** Catalog price at capture time — informational only; conversion
   *  re-prices from the live catalog. */
  pricePoishaAtCapture: number;
}

/** The partial address a shopper had typed; every field optional. */
export interface CapturedAddress {
  division?: string;
  district?: string;
  upazila?: string;
  union?: string;
  addressLine?: string;
}

export type AbandonedStatus = "OPEN" | "RECOVERED" | "DISMISSED" | "EXPIRED";

const CAPTURE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Rate limiting (public capture endpoint)                             */
/* ------------------------------------------------------------------ */

/**
 * Capture is debounced client-side, so a real shopper produces a
 * handful of calls; 30 per 10 minutes per (phone + IP) is generous
 * headroom while still stopping scripted cart-spam. Same limiter
 * class the public contact endpoint uses.
 */
export const abandonedCaptureLimiter = new ContactRateLimiter(30, 10 * 60 * 1000);

export function abandonedCaptureRateKey(rawPhone: string, ip: string): string {
  return `${rawPhone}|${ip}`;
}

/* ------------------------------------------------------------------ */
/* Capture                                                             */
/* ------------------------------------------------------------------ */

const looseAddressSchema = z.object({
  division: z.string().trim().max(120).optional(),
  district: z.string().trim().max(120).optional(),
  upazila: z.string().trim().max(120).optional(),
  union: z.string().trim().max(120).optional(),
  addressLine: z.string().trim().max(500).optional(),
});

export const captureAbandonedSchema = z.object({
  sessionKey: z.string().uuid("sessionKey must be a UUID"),
  phone: z.string().min(1),
  name: z.string().trim().max(120).optional(),
  items: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1, "Cart khali — age product add korun")
    .max(50),
  address: looseAddressSchema.optional(),
});

export type CaptureAbandonedInput = z.infer<typeof captureAbandonedSchema>;

export interface CaptureResult {
  id: string;
  status: AbandonedStatus;
  /** True when the session was already closed (RECOVERED/DISMISSED)
   *  and this capture changed nothing. */
  closed: boolean;
  /** Variant ids the client sent that do not exist (dropped). */
  droppedVariantIds: string[];
}

export async function captureAbandonedCheckout(
  input: CaptureAbandonedInput,
): Promise<CaptureResult> {
  const phone = normalizeBdPhone(input.phone);
  if (!phone) {
    throw new AbandonedError(
      "INVALID_PHONE",
      "সঠিক বাংলাদেশি মোবাইল নম্বর দিন। / Enter a valid Bangladeshi mobile number.",
      422,
    );
  }

  // Merge duplicate lines, then resolve against the catalog: unknown
  // variant ids are dropped (a stale cart can hold a deleted variant);
  // if NOTHING resolves there is no cart worth capturing.
  const merged = new Map<string, number>();
  for (const item of input.items) {
    merged.set(item.variantId, Math.min(99, (merged.get(item.variantId) ?? 0) + item.quantity));
  }
  const snapshots = await getVariantSnapshots([...merged.keys()]);
  const items: CapturedItem[] = [];
  const droppedVariantIds: string[] = [];
  let subtotalPoisha = 0;
  for (const [variantId, quantity] of merged) {
    const server = snapshots.get(variantId);
    if (!server) {
      droppedVariantIds.push(variantId);
      continue;
    }
    items.push({ variantId, quantity, pricePoishaAtCapture: server.unitPricePoisha });
    subtotalPoisha += server.unitPricePoisha * quantity;
  }
  if (items.length === 0) {
    throw new AbandonedError(
      "NO_VALID_ITEMS",
      "কার্টের কোনো পণ্যই আর পাওয়া যাচ্ছে না। / None of the cart items are available anymore.",
      422,
      { droppedVariantIds },
    );
  }

  const address: CapturedAddress | null = input.address
    ? (Object.fromEntries(
        Object.entries(input.address).filter(([, v]) => typeof v === "string" && v !== ""),
      ) as CapturedAddress)
    : null;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CAPTURE_TTL_MS);

  const existing = await prisma.abandonedCheckout.findUnique({
    where: { sessionKey: input.sessionKey },
    select: { id: true, status: true },
  });
  if (
    existing &&
    (existing.status === "RECOVERED" || existing.status === "DISMISSED")
  ) {
    // Closed sessions stay closed — the capture is a no-op so a stray
    // debounced send racing the order placement can never reopen it.
    return {
      id: existing.id,
      status: existing.status as AbandonedStatus,
      closed: true,
      droppedVariantIds,
    };
  }

  // Prisma's Json input type rejects plain interfaces (no index
  // signature); both values are plain JSON by construction — the same
  // `as never` pattern src/lib/audit.ts uses for its Json columns.
  const row = await prisma.abandonedCheckout.upsert({
    where: { sessionKey: input.sessionKey },
    create: {
      sessionKey: input.sessionKey,
      customerPhone: phone,
      customerName: input.name?.trim() ? input.name.trim() : null,
      itemsJson: items as never,
      addressJson: (address ?? undefined) as never,
      subtotalPoisha,
      status: "OPEN",
      expiresAt,
      lastSeenAt: now,
    },
    update: {
      customerPhone: phone,
      customerName: input.name?.trim() ? input.name.trim() : undefined,
      itemsJson: items as never,
      addressJson: (address ?? undefined) as never,
      subtotalPoisha,
      status: "OPEN",
      expiresAt,
      lastSeenAt: now,
    },
  });
  // Automation lifecycle (ADV-7): checkout.abandoned fires ONLY for a
  // brand-new capture — the storefront re-posts the same sessionKey on
  // a debounce while the shopper edits, and those refresh posts must
  // not re-fire the event (the engine's abandonedMinutes conditions
  // evaluate against lastSeenAt when the job runs). A closed session
  // returned early above and never reaches here. The producer is
  // flag-gated and never throws.
  if (existing === null) {
    await emitAutomationEvent("checkout.abandoned", row.id);
  }
  return { id: row.id, status: "OPEN", closed: false, droppedVariantIds };
}

/**
 * Stamp a capture RECOVERED because its own session completed a real
 * order (called from the public orders route post-commit). Only an
 * OPEN row transitions; anything else is left untouched. Never throws
 * into the caller — the route still wraps it, belt and braces.
 */
export async function markAbandonedCheckoutRecovered(
  sessionKey: string,
  orderId: string,
): Promise<void> {
  await prisma.abandonedCheckout.updateMany({
    where: { sessionKey, status: "OPEN" },
    data: { status: "RECOVERED", recoveredOrderId: orderId },
  });
}

/* ------------------------------------------------------------------ */
/* Admin reads                                                         */
/* ------------------------------------------------------------------ */

export interface AbandonedListItem {
  id: string;
  customerPhoneMasked: string;
  customerName: string | null;
  items: (CapturedItem & { productName: string | null; sku: string | null })[];
  itemCount: number;
  subtotalPoisha: number;
  address: CapturedAddress | null;
  hasCallTask: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ageMinutes: number;
}

/** OPEN + unexpired captures, newest activity first, capped at 100. */
export async function listOpenAbandonedCheckouts(): Promise<{
  rows: AbandonedListItem[];
  total: number;
}> {
  const now = new Date();
  const where = { status: "OPEN", expiresAt: { gt: now } };
  const [total, rows] = await Promise.all([
    prisma.abandonedCheckout.count({ where }),
    prisma.abandonedCheckout.findMany({
      where,
      orderBy: { lastSeenAt: "desc" },
      take: 100,
    }),
  ]);
  const variantIds = [
    ...new Set(rows.flatMap((r) => (r.itemsJson as unknown as CapturedItem[]).map((i) => i.variantId))),
  ];
  const snapshots = variantIds.length > 0 ? await getVariantSnapshots(variantIds) : new Map();
  return {
    total,
    rows: rows.map((row) => {
      const items = row.itemsJson as unknown as CapturedItem[];
      return {
        id: row.id,
        // The full number NEVER leaves this module's admin surface.
        customerPhoneMasked: maskPhone(row.customerPhone),
        customerName: row.customerName,
        items: items.map((i) => ({
          ...i,
          productName: snapshots.get(i.variantId)?.productName ?? null,
          sku: snapshots.get(i.variantId)?.sku ?? null,
        })),
        itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
        subtotalPoisha: row.subtotalPoisha,
        address: (row.addressJson as CapturedAddress | null) ?? null,
        hasCallTask: row.callTaskId !== null,
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        ageMinutes: Math.max(0, Math.floor((now.getTime() - row.lastSeenAt.getTime()) / 60000)),
      };
    }),
  };
}

async function loadCapture(id: string) {
  const row = await prisma.abandonedCheckout.findUnique({ where: { id } });
  if (!row) {
    throw new AbandonedError("NOT_FOUND", "Abandoned checkout not found.", 404);
  }
  return row;
}

/* ------------------------------------------------------------------ */
/* Call task                                                           */
/* ------------------------------------------------------------------ */

/**
 * Create a call-center follow-up task for a capture. CallTask has no
 * `source` column — the queue source lives in `kind`, and
 * ABANDONED_CHECKOUT is one of the CallQueueSource values the queue
 * already understands (priority 20 via priorityForSource). Like a
 * MANUAL task, this task has no linked order to resolve a number
 * from, so the FULL phone + name persist on the task row itself,
 * server-side only (views mask it; phoneFull stays permission-gated).
 */
export async function createAbandonedCallTask(id: string): Promise<{
  callTaskId: string;
  alreadyCreated: boolean;
}> {
  const row = await loadCapture(id);
  if (row.status !== "OPEN") {
    throw new AbandonedError(
      "CAPTURE_CLOSED",
      "এই ক্যাপচারটি আর খোলা নেই। / This capture is no longer open.",
      409,
    );
  }
  if (row.callTaskId) {
    return { callTaskId: row.callTaskId, alreadyCreated: true };
  }
  const items = row.itemsJson as unknown as CapturedItem[];
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const task = await prisma.callTask.create({
    data: {
      kind: "ABANDONED_CHECKOUT",
      priority: priorityForSource("ABANDONED_CHECKOUT"),
      status: "QUEUED",
      customerPhoneMasked: maskPhone(row.customerPhone),
      customerPhone: row.customerPhone,
      customerName: row.customerName,
      note: `পরিত্যক্ত চেকআউট ফলো-আপ — ${itemCount}টি পণ্য, কার্ট মূল্য ${row.subtotalPoisha} পয়সা। Abandoned checkout ${row.id}.`,
      attempts: 0,
    },
  });
  await prisma.abandonedCheckout.update({
    where: { id: row.id },
    data: { callTaskId: task.id },
  });
  return { callTaskId: task.id, alreadyCreated: false };
}

/* ------------------------------------------------------------------ */
/* Dismiss                                                             */
/* ------------------------------------------------------------------ */

export async function dismissAbandonedCheckout(id: string): Promise<{
  alreadyDismissed: boolean;
}> {
  const row = await loadCapture(id);
  if (row.status === "DISMISSED") return { alreadyDismissed: true };
  if (row.status === "RECOVERED") {
    throw new AbandonedError(
      "CAPTURE_RECOVERED",
      "এই ক্যাপচার থেকে ইতিমধ্যে অর্ডার হয়েছে, তাই বাতিল করা যাবে না। / This capture already became an order and cannot be dismissed.",
      409,
    );
  }
  await prisma.abandonedCheckout.update({
    where: { id: row.id },
    data: { status: "DISMISSED" },
  });
  return { alreadyDismissed: false };
}

/* ------------------------------------------------------------------ */
/* Convert                                                             */
/* ------------------------------------------------------------------ */

export interface ConvertResult {
  orderId: string;
  orderNo: string;
  alreadyConverted: boolean;
}

/**
 * Turn a capture into a REAL order at CURRENT catalog prices, through
 * the same createOrderRecord funnel the staff manual route uses
 * (stock reservation, fraud scoring, one transaction). The
 * idempotency key is derived from the capture id, so a double-click,
 * a retry, or two staff converting at once can only ever produce ONE
 * order; the RECOVERED short-circuit above it is just the fast path.
 */
export async function convertAbandonedCheckout(id: string): Promise<ConvertResult> {
  const row = await loadCapture(id);
  if (row.status === "RECOVERED" && row.recoveredOrderId) {
    const existing = await prisma.order.findUnique({
      where: { id: row.recoveredOrderId },
      select: { id: true, orderNo: true },
    });
    if (existing) {
      return { orderId: existing.id, orderNo: existing.orderNo, alreadyConverted: true };
    }
  }
  if (row.status === "DISMISSED") {
    throw new AbandonedError(
      "CAPTURE_DISMISSED",
      "বাতিল করা ক্যাপচার থেকে অর্ডার করা যাবে না। / A dismissed capture cannot be converted.",
      409,
    );
  }

  const capturedItems = row.itemsJson as unknown as CapturedItem[];
  const capturedAddress = (row.addressJson as CapturedAddress | null) ?? null;

  // Re-resolve every line against the LIVE catalog (existence, stock,
  // current price) — the capture-time prices are never charged.
  const snapshots = await getVariantSnapshots(capturedItems.map((i) => i.variantId));
  const typesOn = await productTypesEnabledInDb();
  const items: Order["items"] = [];
  let subtotalPoisha = 0;
  let totalWeightGrams = 0;
  for (const line of capturedItems) {
    const server = snapshots.get(line.variantId);
    if (!server) {
      throw new AbandonedError(
        "VARIANT_UNAVAILABLE",
        `একটি পণ্য আর পাওয়া যাচ্ছে না (variant ${line.variantId})। ক্যাপচারটি খোলাই রাখা হলো। / One of the items is no longer available. The capture stays open.`,
        409,
        { variantId: line.variantId },
      );
    }
    const availableStock =
      typesOn && server.productType === "BUNDLE" && server.bundleAvailability !== null
        ? server.bundleAvailability
        : server.stock;
    if (availableStock < line.quantity) {
      throw new AbandonedError(
        "INSUFFICIENT_STOCK",
        `${server.sku} — পর্যাপ্ত স্টক নেই (আছে ${availableStock}, দরকার ${line.quantity})। ক্যাপচারটি খোলাই রাখা হলো। / Insufficient stock for ${server.sku}. The capture stays open.`,
        409,
        { variantId: line.variantId, sku: server.sku, availableStock, requested: line.quantity },
      );
    }
    items.push({
      variantId: server.variantId,
      productName: server.productName,
      sku: server.sku,
      unitPricePoisha: server.unitPricePoisha,
      quantity: line.quantity,
    });
    subtotalPoisha += server.unitPricePoisha * line.quantity;
    totalWeightGrams += server.weightGrams * line.quantity;
  }

  // Address: whatever the shopper had typed. Missing district → the
  // shipping engine prices outside-Dhaka (zoneForDistrict of an unknown
  // district), and the order note tells staff to confirm the address
  // on the phone before dispatch.
  const district = capturedAddress?.district?.trim() ?? "";
  const address: BdAddress = {
    division: capturedAddress?.division?.trim() ?? "",
    district,
    upazila: capturedAddress?.upazila?.trim() ?? "",
    union: capturedAddress?.union?.trim() || undefined,
    addressLine: capturedAddress?.addressLine?.trim() ?? "",
  };
  const shipping = await computeOrderShipping({
    district,
    shippingMethod: "outside_dhaka",
    totalWeightGrams,
    subtotalPoisha,
  });
  const pricing = computePricing({
    itemsSubtotalPoisha: subtotalPoisha,
    couponDiscountPoisha: 0,
    shippingPoisha: shipping.shippingPoisha,
    codFeePoisha: shipping.codFeePoisha,
    taxBps: 0,
  });

  // Same fraud scoring + enforcement as the manual route; a block
  // refuses the conversion and the capture stays OPEN.
  const priorOrders = await listOrdersByPhone(row.customerPhone);
  const now = new Date().toISOString();
  const assessment = scoreFraud(
    await assembleFraudInput({
      phone: row.customerPhone,
      address: {
        division: address.division,
        district: address.district,
        upazila: address.upazila,
      },
      paymentMethod: "cod",
      totalPoisha: pricing.grandTotalPoisha,
      itemKeys: items.map((i) => i.variantId),
      priorOrders,
      now,
    }),
  );
  const enforcement = fraudEnforcement(assessment);
  if (enforcement.blocked) {
    throw new AbandonedError(
      "FRAUD_BLOCKED",
      "দুঃখিত, এই অর্ডারটি গ্রহণ করা যাচ্ছে না। সহায়তার জন্য আমাদের সাথে যোগাযোগ করুন। / Sorry, this order cannot be accepted. Please contact support for help.",
      422,
    );
  }
  const advanceCandidates: AdvanceCandidate[] = [];
  if (enforcement.advanceRequired) {
    const rules = await loadOrderRules();
    advanceCandidates.push({
      amountPoisha: percentAdvancePoisha(pricing.grandTotalPoisha, rules.advancePercent),
      reason: ADVANCE_REASON_LABELS.fraud_review,
    });
  }
  const advanceRequirement = pickAdvanceRequirement(advanceCandidates);

  const noteParts = [
    `Converted from abandoned checkout ${row.id}.`,
    district === ""
      ? "জেলা ধরা পড়েনি — ঢাকার বাইরের ডেলিভারি চার্জ ধরা হয়েছে এবং ডেলিভারির ঠিকানা ফোনে নিশ্চিত করতে হবে। / District was not captured — outside-Dhaka delivery charge applied; confirm the delivery address with the customer by phone."
      : null,
    !address.addressLine
      ? "বিস্তারিত ঠিকানা ধরা পড়েনি — ফোনে ঠিকানা নিশ্চিত করুন। / Street address was not captured — confirm it by phone."
      : null,
  ].filter((p): p is string => p !== null);

  let created: Awaited<ReturnType<typeof createOrderRecord>>;
  try {
    created = await createOrderRecord({
      idempotencyKey: `abandoned-convert-${row.id}`,
      customerName: row.customerName?.trim() ? row.customerName.trim() : "Customer",
      customerPhone: row.customerPhone,
      address,
      items,
      pricing: {
        subtotalPoisha: pricing.subtotalPoisha,
        discountPoisha: pricing.couponDiscountPoisha,
        shippingPoisha: pricing.shippingPoisha,
        codFeePoisha: pricing.codFeePoisha,
        taxPoisha: pricing.taxPoisha,
        totalPoisha: pricing.grandTotalPoisha,
      },
      paymentMethod: "cod",
      riskScore: assessment.score,
      advanceRequiredPoisha: advanceRequirement.advanceRequiredPoisha,
      advanceReason: advanceRequirement.advanceReason ?? undefined,
      requiresOtp: enforcement.requiresOtp,
      appliedCoupon: null,
      note: noteParts.join("\n"),
      source: "manual",
    });
  } catch (e) {
    if (e instanceof BundleStockError) {
      throw new AbandonedError("INSUFFICIENT_STOCK", e.message, 409, e.details);
    }
    if (e instanceof PreorderCapError) {
      throw new AbandonedError("PREORDER_CAP_REACHED", e.message, 409, e.details);
    }
    throw e;
  }

  if (created.replayed) {
    // A concurrent (or earlier crashed-after-create) conversion won;
    // adopt its order instead of duplicating.
    const existingRow = await findOrderByIdempotencyKey(`abandoned-convert-${row.id}`);
    if (!existingRow) {
      throw new AbandonedError("IDEMPOTENCY_CONFLICT", "This conversion was already processed.", 409);
    }
    await prisma.abandonedCheckout.update({
      where: { id: row.id },
      data: { status: "RECOVERED", recoveredOrderId: existingRow.id },
    });
    return { orderId: existingRow.id, orderNo: existingRow.orderNo, alreadyConverted: true };
  }

  const storedRow = await findOrderByIdempotencyKey(`abandoned-convert-${row.id}`);
  if (storedRow) publishOrderCreated(orderRowToEnriched(storedRow));
  await prisma.abandonedCheckout.update({
    where: { id: row.id },
    data: { status: "RECOVERED", recoveredOrderId: created.orderId },
  });
  return { orderId: created.orderId, orderNo: created.orderNo, alreadyConverted: false };
}
