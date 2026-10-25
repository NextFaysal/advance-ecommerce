/**
 * Split shipments — doc 17, batch O5 (part 2).
 *
 * A "booking" is a Shipment row. Before this module every booking
 * implicitly carried the WHOLE order; a split booking carries only the
 * lines listed in Shipment.lineItemsJson ([{ orderItemId, quantity }]).
 * lineItemsJson === null therefore means "whole order" and every
 * pre-existing booking keeps its meaning untouched.
 *
 * Rules owned here:
 *  - Allocation: a line's quantity may be allocated across bookings at
 *    most up to the ordered quantity. FAILED bookings (the sandbox
 *    cancel-before-pickup mapping) release their allocation; every
 *    other status holds it.
 *  - Partial delivery: a DELIVERED event against a split booking must
 *    NOT deliver the whole order until every line is fully covered by
 *    DELIVERED bookings (`isOrderFullyDelivered`). Until then the order
 *    stays SHIPPED and a "partial delivery" note lands on the timeline.
 *  - Order status moves go ONLY through O5-1's shared helper
 *    (src/courier/order-sync.ts) — never a direct status write — so the
 *    advance gate, delivered hooks and COD recording stay funnelled.
 *
 * Sandbox honesty: bookings created here are sandbox bookings, exactly
 * like POST /api/v1/admin/shipments — SBX-prefixed tracking ids from
 * the deterministic helpers, charge from courierChargePoisha(), and no
 * real courier is contacted.
 */
import { prisma } from "@advance-ecommerce/db";
import { transitionOrderForCourierEvent } from "@/courier/order-sync";
import { applyShipmentStatus } from "@/integrations/sandbox/db-store";
import { courierChargePoisha } from "@/integrations/sandbox/courier-rates";
import { sandboxShipmentId, sandboxTrackingId } from "@/integrations/sandbox/deterministic";
import { SANDBOX_COURIER_PROVIDERS } from "@/integrations/sandbox/courier-provider";

export interface SplitAllocation {
  orderItemId: string;
  quantity: number;
}

export interface ShipmentLineCoverage {
  orderItemId: string;
  productName: string;
  sku: string;
  quantity: number;
  allocatedQuantity: number;
  deliveredQuantity: number;
  remainingQuantity: number;
}

export interface ShipmentBookingView {
  id: string;
  provider: string;
  trackingId: string | null;
  status: string;
  codAmountPoisha: number;
  chargePoisha: number;
  weightGrams: number | null;
  createdAt: string;
  /** null = whole-order booking. */
  items: SplitAllocation[] | null;
}

export interface OrderShipmentCoverage {
  bookings: ShipmentBookingView[];
  lines: ShipmentLineCoverage[];
  coverage: {
    totalLines: number;
    /** Lines whose full ordered quantity is allocated to live bookings. */
    allocatedLines: number;
    /** Lines whose full ordered quantity sits in DELIVERED bookings. */
    deliveredLines: number;
  };
}

export type SplitResult<T> = { ok: true; value: T } | { ok: false; code: string; error: string };

/** Parse the stored allocation JSON defensively (rows are ours, but a
 *  hand-edited row must degrade to "no allocations", never crash). */
export function parseAllocations(json: unknown): SplitAllocation[] {
  if (!Array.isArray(json)) return [];
  const out: SplitAllocation[] = [];
  for (const raw of json) {
    if (typeof raw !== "object" || raw === null) continue;
    const { orderItemId, quantity } = raw as { orderItemId?: unknown; quantity?: unknown };
    if (typeof orderItemId === "string" && Number.isInteger(quantity) && (quantity as number) > 0) {
      out.push({ orderItemId, quantity: quantity as number });
    }
  }
  return out;
}

/** One timeline note on the order (OrderNote with no staff author). */
export async function addOrderTimelineNote(orderId: string, text: string): Promise<void> {
  await prisma.orderNote.create({ data: { orderId, text } });
}

type ShipmentRow = Awaited<ReturnType<typeof prisma.shipment.findMany>>[number];

async function loadCoverageRows(orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: {
      id: true,
      status: true,
      paymentMethod: true,
      items: {
        select: { id: true, productName: true, sku: true, quantity: true, unitPricePoisha: true, variantId: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!order) return null;
  const shipments = await prisma.shipment.findMany({
    where: { orderId, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  return { order, shipments };
}

function accumulate(
  order: NonNullable<Awaited<ReturnType<typeof loadCoverageRows>>>["order"],
  shipments: ShipmentRow[],
) {
  const allocated = new Map<string, number>();
  const delivered = new Map<string, number>();
  for (const s of shipments) {
    if (s.status === "FAILED") continue; // cancelled/failed bookings release their lines
    const allocs =
      s.lineItemsJson === null
        ? order.items.map((i) => ({ orderItemId: i.id, quantity: i.quantity }))
        : parseAllocations(s.lineItemsJson);
    for (const a of allocs) {
      allocated.set(a.orderItemId, (allocated.get(a.orderItemId) ?? 0) + a.quantity);
      if (s.status === "DELIVERED") {
        delivered.set(a.orderItemId, (delivered.get(a.orderItemId) ?? 0) + a.quantity);
      }
    }
  }
  return { allocated, delivered };
}

/** Bookings + per-line allocation/delivery coverage for one order. */
export async function getOrderShipmentCoverage(orderId: string): Promise<OrderShipmentCoverage | null> {
  const loaded = await loadCoverageRows(orderId);
  if (!loaded) return null;
  const { order, shipments } = loaded;
  const { allocated, delivered } = accumulate(order, shipments);
  const itemById = new Map(order.items.map((i) => [i.id, i]));
  const lines: ShipmentLineCoverage[] = order.items.map((i) => {
    const a = allocated.get(i.id) ?? 0;
    const d = delivered.get(i.id) ?? 0;
    return {
      orderItemId: i.id,
      productName: i.productName,
      sku: i.sku,
      quantity: i.quantity,
      allocatedQuantity: a,
      deliveredQuantity: d,
      remainingQuantity: Math.max(0, i.quantity - a),
    };
  });
  return {
    bookings: shipments.map((s) => ({
      id: s.id,
      provider: s.provider,
      trackingId: s.trackingId,
      status: s.status,
      codAmountPoisha: s.codAmountPoisha,
      chargePoisha: s.chargePoisha,
      weightGrams: s.weightGrams,
      createdAt: s.createdAt.toISOString(),
      items:
        s.lineItemsJson === null
          ? null
          : parseAllocations(s.lineItemsJson).map((a) => ({
              ...a,
              productName: itemById.get(a.orderItemId)?.productName,
              sku: itemById.get(a.orderItemId)?.sku,
            })),
    })),
    lines,
    coverage: {
      totalLines: lines.length,
      allocatedLines: lines.filter((l) => l.allocatedQuantity >= l.quantity).length,
      deliveredLines: lines.filter((l) => l.deliveredQuantity >= l.quantity).length,
    },
  };
}

/**
 * True only when every order line is fully covered by DELIVERED
 * bookings. An order with no bookings at all is NOT fully delivered
 * (nothing has been delivered through shipments); whole-order bookings
 * (lineItemsJson null) cover every line when DELIVERED.
 */
export async function isOrderFullyDelivered(orderId: string): Promise<boolean> {
  const loaded = await loadCoverageRows(orderId);
  if (!loaded) return false;
  const { order, shipments } = loaded;
  if (shipments.length === 0 || order.items.length === 0) return false;
  const { delivered } = accumulate(order, shipments);
  return order.items.every((i) => (delivered.get(i.id) ?? 0) >= i.quantity);
}

/** Does this order carry any split booking (lineItemsJson set)? */
export async function orderHasSplitShipments(orderId: string): Promise<boolean> {
  const rows = await prisma.shipment.findMany({
    where: { orderId, deletedAt: null },
    select: { lineItemsJson: true },
  });
  return rows.some((r) => r.lineItemsJson !== null);
}

export interface CreateSplitShipmentInput {
  items: SplitAllocation[];
  provider?: string;
  note?: string;
}

/**
 * Create ONE split booking for exactly the requested lines. Validates
 * order existence/state, item ownership and remaining allocatable
 * quantity (ordered − already-allocated, whole-order bookings allocate
 * everything). The booking is a sandbox booking (see header): status
 * CREATED + its CREATED event, SBX tracking id, charge from the real
 * rate function, COD amount = the allocated lines' goods value, weight
 * = Σ variant product weight × qty (null when no line carries weight).
 */
export async function createSplitShipment(
  orderId: string,
  input: CreateSplitShipmentInput,
): Promise<SplitResult<ShipmentBookingView>> {
  const provider = input.provider ?? "steadfast";
  if (!(SANDBOX_COURIER_PROVIDERS as readonly string[]).includes(provider)) {
    return { ok: false, code: "INVALID_PROVIDER", error: `Unknown sandbox courier provider: ${provider}.` };
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { ok: false, code: "INVALID_INPUT", error: "At least one line item is required. / অন্তত একটি পণ্য লাইন আবশ্যক।" };
  }
  const seen = new Set<string>();
  for (const item of input.items) {
    if (!item.orderItemId || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { ok: false, code: "INVALID_INPUT", error: "Every item needs an orderItemId and a positive integer quantity." };
    }
    if (seen.has(item.orderItemId)) {
      return { ok: false, code: "INVALID_INPUT", error: "The same line appears twice; merge the quantities." };
    }
    seen.add(item.orderItemId);
  }

  const loaded = await loadCoverageRows(orderId);
  if (!loaded) return { ok: false, code: "ORDER_NOT_FOUND", error: "Order not found. / অর্ডার পাওয়া যায়নি।" };
  const { order, shipments } = loaded;
  if (order.status === "CANCELLED" || order.status === "REFUNDED" || order.status === "RETURNED") {
    return { ok: false, code: "ORDER_CLOSED", error: `Order is ${order.status}; no new shipments can be booked.` };
  }
  const itemById = new Map(order.items.map((i) => [i.id, i]));
  for (const item of input.items) {
    if (!itemById.has(item.orderItemId)) {
      return { ok: false, code: "ITEM_NOT_IN_ORDER", error: `Line ${item.orderItemId} does not belong to this order.` };
    }
  }
  const { allocated } = accumulate(order, shipments);
  for (const item of input.items) {
    const line = itemById.get(item.orderItemId)!;
    const remaining = line.quantity - (allocated.get(item.orderItemId) ?? 0);
    if (item.quantity > remaining) {
      return {
        ok: false,
        code: "OVER_ALLOCATED",
        error: `Line "${line.productName}" (${line.sku}): requested ${item.quantity}, only ${remaining} of ${line.quantity} left unallocated. / বরাদ্দের বেশি চাওয়া হয়েছে।`,
      };
    }
  }

  // Weight + COD goods value for exactly the allocated lines.
  const variantIds = input.items.map((i) => itemById.get(i.orderItemId)!.variantId);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, product: { select: { weightGrams: true } } },
  });
  const weightByVariant = new Map(variants.map((v) => [v.id, v.product.weightGrams ?? 0]));
  let weightGrams = 0;
  let codAmountPoisha = 0;
  for (const item of input.items) {
    const line = itemById.get(item.orderItemId)!;
    codAmountPoisha += line.unitPricePoisha * item.quantity;
    weightGrams += (weightByVariant.get(line.variantId) ?? 0) * item.quantity;
  }

  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const idempotencyKey = `split:${orderId}:${stamp}`;
  const shipmentId = sandboxShipmentId(provider, idempotencyKey);
  const row = await prisma.shipment.create({
    data: {
      id: shipmentId,
      orderId,
      provider,
      trackingId: sandboxTrackingId(provider, idempotencyKey),
      status: "CREATED",
      codAmountPoisha,
      chargePoisha: courierChargePoisha("district", weightGrams > 0 ? weightGrams : 1000),
      weightGrams: weightGrams > 0 ? weightGrams : null,
      lineItemsJson: input.items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity })),
      events: { create: { status: "CREATED", idempotencyKey: `booking:${idempotencyKey}` } },
    },
  });
  if (input.note?.trim()) {
    await addOrderTimelineNote(orderId, `বিভক্ত শিপমেন্ট তৈরি (${row.trackingId ?? row.id}): ${input.note.trim()}`);
  }
  return {
    ok: true,
    value: {
      id: row.id,
      provider: row.provider,
      trackingId: row.trackingId,
      status: row.status,
      codAmountPoisha: row.codAmountPoisha,
      chargePoisha: row.chargePoisha,
      weightGrams: row.weightGrams,
      createdAt: row.createdAt.toISOString(),
      items: input.items,
    },
  };
}

export interface CompleteSplitDeliveryResult {
  shipmentId: string;
  fullyDelivered: boolean;
  orderApplied: boolean;
  orderReason?: string;
}

/**
 * Mark one split booking DELIVERED (manual/staff completion for a
 * parcel — the courier-webhook path is O5-1's) and settle the order
 * under the partial-delivery rule:
 *  - every line covered by DELIVERED bookings → the order transitions
 *    to DELIVERED through the shared helper, with the total COD of all
 *    delivered bookings as the collected amount (COD orders only).
 *  - otherwise → "partial delivery" timeline note naming the booking,
 *    and the order is moved to (or kept at) SHIPPED via the helper.
 * Idempotent: re-completing an already-DELIVERED booking re-evaluates
 * the order state without writing a second event or note.
 */
export async function completeSplitShipmentDelivery(
  shipmentId: string,
  opts?: { codCollectedPoisha?: number },
): Promise<SplitResult<CompleteSplitDeliveryResult>> {
  const shipment = await prisma.shipment.findFirst({ where: { id: shipmentId, deletedAt: null } });
  if (!shipment) return { ok: false, code: "SHIPMENT_NOT_FOUND", error: "Shipment not found." };
  const alreadyDelivered = shipment.status === "DELIVERED";
  if (!alreadyDelivered) {
    try {
      await applyShipmentStatus(shipmentId, "DELIVERED", {
        eventIdempotencyKey: `split-delivered:${shipmentId}`,
        providerRawStatus: "delivered (staff-confirmed split parcel)",
      });
    } catch (err) {
      // UNIQUE event key backstop: a concurrent completion won the race.
      if (!(typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002")) throw err;
    }
  }

  const fully = await isOrderFullyDelivered(shipment.orderId);
  if (fully) {
    const order = await prisma.order.findUnique({
      where: { id: shipment.orderId },
      select: { paymentMethod: true, status: true },
    });
    let codCollectedPoisha: number | undefined;
    if (order?.paymentMethod === "COD") {
      const deliveredShipments = await prisma.shipment.findMany({
        where: { orderId: shipment.orderId, deletedAt: null, status: "DELIVERED" },
        select: { id: true, codAmountPoisha: true },
      });
      codCollectedPoisha = deliveredShipments.reduce(
        (sum, s) => sum + (s.id === shipmentId && opts?.codCollectedPoisha !== undefined ? opts.codCollectedPoisha : s.codAmountPoisha),
        0,
      );
    }
    const result = await transitionOrderForCourierEvent(shipment.orderId, "DELIVERED", {
      provider: shipment.provider,
      eventId: `split-delivered:${shipmentId}`,
      codCollectedPoisha,
      note: "All split parcels delivered. / সব বিভক্ত পার্সেল ডেলিভার্ড।",
    });
    return {
      ok: true,
      value: { shipmentId, fullyDelivered: true, orderApplied: result.applied, orderReason: result.reason },
    };
  }

  // Partial: note (once — skip on idempotent replays) + keep the order SHIPPED.
  if (!alreadyDelivered) {
    await addOrderTimelineNote(
      shipment.orderId,
      `আংশিক ডেলিভারি: পার্সেল ${shipment.trackingId ?? shipment.id} ডেলিভার্ড হয়েছে, তবে অর্ডারের সব পণ্য এখনো পৌঁছায়নি — অর্ডার SHIPPED অবস্থাতেই থাকল। / Partial delivery: parcel ${shipment.trackingId ?? shipment.id} (booking ${shipment.id}) was delivered, but not every line is covered yet — the order stays SHIPPED.`,
    );
  }
  const shipped = await transitionOrderForCourierEvent(shipment.orderId, "SHIPPED", {
    provider: shipment.provider,
    eventId: `split-partial:${shipmentId}`,
    note: "Partial split delivery. / আংশিক ডেলিভারি।",
  });
  return {
    ok: true,
    value: { shipmentId, fullyDelivered: false, orderApplied: shipped.applied, orderReason: shipped.reason },
  };
}
