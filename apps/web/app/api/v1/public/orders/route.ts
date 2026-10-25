/**
 * POST /api/v1/public/orders — public order create.
 *
 * CONTRACT (consistent API format):
 *   success: { data: { order, pricing }, meta: {...} }
 *   error:   { error: { code, message, details } }
 *
 * REAL, wired in this file:
 * - Zod validation on every input (checkoutFormSchema: phone required,
 *   BD regex, normalized to +8801XXXXXXXXX, email optional, address
 *   Division > District > Upazila > Union, items >= 1, UUID idempotencyKey)
 * - Server-side price re-validation: client sends NO price. Prices, SKU,
 *   product name and stock are read from the DATABASE (Prisma
 *   ProductVariant via src/orders/repository.getVariantSnapshots).
 *   A client total is never trusted.
 * - Pricing pipeline, integer poisha only: subtotal -> coupon -> shipping
 *   -> COD fee -> tax (0 bps for now) -> grand total.
 * - Coupon (Agent 59): a submitted couponCode is evaluated with the REAL
 *   applyCoupon() (src/marketing/service) via src/checkout/
 *   order-enrichment and applied INSIDE the pipeline at the coupon stage.
 *   An ineligible/unknown code never fails the order: it is created with
 *   a 0 discount and couponStatus "rejected" + the bn/en reason.
 * - Fraud (Agent 59): every create is scored with the REAL scoreFraud()
 *   (src/fraud) over the demo list store + the customer's prior orders
 *   read from the DATABASE. Suggested action "block" -> 422
 *   FRAUD_BLOCKED (generic message, no signal details leave the server);
 *   "require_advance" -> the order is created flagged advanceRequired +
 *   requiresOtp. The real score is persisted as Order.riskScore.
 * - Reseller attribution (wave 6): an optional resellerCode (captured
 *   client-side from a ?ref=CODE share link) is resolved by
 *   src/reseller/store.resolveResellerAttribution — ACTIVE resellers
 *   only, mirroring the wallet credit guard — and persisted as
 *   Order.resellerId in the create transaction, which is what makes
 *   the delivered-order reseller credit fire. Unknown/ineligible
 *   codes attribute nothing and never fail the order; the outcome is
 *   reported as meta.resellerAttributed.
 * - Idempotency: a duplicate idempotencyKey returns the ORIGINAL order
 *   (a replay never re-applies a coupon or re-scores), never a second
 *   order. The durable backstop is the UNIQUE Order.idempotencyKey
 *   column (src/orders/repository.createOrderRecord converts a P2002
 *   race into a replay); the in-memory claim below still guards
 *   double-submits inside this process, including the FRAUD_BLOCKED
 *   retry -> 409 behaviour.
 * - Persistence (DB swap): the order is written by
 *   src/orders/repository.createOrderRecord in ONE prisma.$transaction:
 *   Customer find-or-create by phone (+ default Address), Order +
 *   OrderItems (purchase-time snapshots), OrderStatusHistory
 *   (null -> PENDING), Payment row (UNPAID), and a CouponUsage row when
 *   the applied coupon exists as a DB Coupon (@@unique([couponId,
 *   orderId]) backstop). meta.db = "PRISMA".
 * - order.created is published on the in-process bus only after the
 *   transaction commits — never on a replay or a fraud block.
 *
 * STILL DEMO / NOT THIS SLICE:
 * - The coupon RECORDS evaluated by evaluateOrderCoupon still come from
 *   the marketing module's demo records / in-memory store (the coupon
 *   module's own DB swap is separate); recordCouponUse() remains that
 *   module's bookkeeping. Stock is a read-only check against the
 *   variant's denormalized stock cache — the checkout path never wrote
 *   stock_movements before this swap and still does not (inventory
 *   module owns the ledger wiring).
 */
import { NextResponse } from "next/server";
import { checkoutFormSchema } from "@/checkout/validation";
import { computePricing } from "@/checkout/pricing";
import { InMemoryIdempotencyStore } from "@/checkout/idempotency";
import {
  assembleFraudInput,
  evaluateOrderCoupon,
  fraudEnforcement,
  recordCouponUse,
  type EnrichedOrder,
} from "@/checkout/order-enrichment";
import { scoreFraud } from "@/fraud/scoring";
import { publishOrderCreated } from "@/orders/event-bus";
import { resolveResellerAttribution } from "@/reseller/store";
import {
  createOrderRecord,
  findOrderByIdempotencyKey,
  getVariantSnapshots,
  listOrdersByPhone,
  orderRowToEnriched,
} from "@/orders/repository";
import type { Order } from "@/orders/types";

function shippingPoisha(method: string): number {
  if (method === "inside_dhaka") return 6000; // ৳60, configurable via settings later
  if (method === "outside_dhaka") return 12000; // ৳120
  return 0; // pickup
}

function codFeePoisha(paymentMethod: string): number {
  return paymentMethod === "cod" ? 0 : 0; // COD fee configurable later; 0 for now, never float
}

function errorResponse(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

// In-process claim guard (double-submit inside this process) + the
// exact create-time EnrichedOrder per order id, so a same-process
// idempotent replay returns the order with its ORIGINAL coupon/fraud
// outcome (the DB row reconstructs it after a restart — see
// src/orders/repository.ts header for what is persisted vs derived).
const idempotencyStore = new InMemoryIdempotencyStore();
const enrichmentByOrderId = new Map<string, EnrichedOrder>();

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = checkoutFormSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "VALIDATION_ERROR",
      "Checkout input invalid.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const form = parsed.data;

  // Idempotency FIRST: duplicate key returns the original persisted
  // order, never a second one.
  const existingRow = await findOrderByIdempotencyKey(form.idempotencyKey);
  if (existingRow) {
    const existing =
      enrichmentByOrderId.get(existingRow.id) ?? orderRowToEnriched(existingRow);
    return NextResponse.json(
      { data: { order: existing, pricing: null }, meta: { idempotentReplay: true, db: "PRISMA" } },
      { status: 200 },
    );
  }
  if (!idempotencyStore.claim(form.idempotencyKey)) {
    return errorResponse("IDEMPOTENCY_CONFLICT", "This checkout attempt was already processed.", 409);
  }

  // Server-side re-validation: price, SKU, name, stock from the DB only.
  const serverPrices = await getVariantSnapshots(form.items.map((i) => i.variantId));
  const snapshotItems: Order["items"] = [];
  let subtotalPoisha = 0;
  for (const item of form.items) {
    const server = serverPrices.get(item.variantId);
    if (!server) {
      return errorResponse("VARIANT_NOT_FOUND", `Variant not found: ${item.variantId}`, 400);
    }
    if (server.stock < item.quantity) {
      return errorResponse(
        "INSUFFICIENT_STOCK",
        `Insufficient stock for ${server.sku}.`,
        400,
        { variantId: item.variantId, sku: server.sku, availableStock: server.stock, requested: item.quantity },
      );
    }
    snapshotItems.push({
      variantId: server.variantId,
      productName: server.productName,
      sku: server.sku,
      unitPricePoisha: server.unitPricePoisha,
      quantity: item.quantity,
    });
    subtotalPoisha += server.unitPricePoisha * item.quantity;
  }

  // The customer's prior orders (real, from the DB) feed both the
  // coupon first-order check and the fraud scorer's history signals.
  const priorOrders = await listOrdersByPhone(form.phone);

  // Coupon: evaluated with the REAL applyCoupon() (see order-enrichment)
  // and applied INSIDE the pricing pipeline at the coupon stage, so the
  // breakdown, the order total and the item snapshots all agree. An
  // ineligible/unknown code does NOT fail the order — discount stays 0
  // and the outcome carries couponStatus "rejected" + the bn/en reason.
  const baseShippingPoisha = shippingPoisha(form.shippingMethod);
  const coupon = evaluateOrderCoupon({
    code: form.couponCode,
    subtotalPoisha,
    shippingPoisha: baseShippingPoisha,
    userKey: form.phone,
    isFirstOrder: priorOrders.length === 0,
  });
  const pricing = computePricing({
    itemsSubtotalPoisha: subtotalPoisha,
    couponDiscountPoisha: coupon.discountPoisha,
    shippingPoisha: coupon.shippingPoisha,
    codFeePoisha: codFeePoisha(form.paymentMethod),
    taxBps: 0,
  });

  // Fraud: scored with the REAL scoreFraud() over facts available at
  // create time (see assembleFraudInput). Enforcement:
  //   block           -> 422, no order is created
  //   require_advance -> order created, flagged advanceRequired/requiresOtp
  //   manual_review / auto_confirm -> order created, assessment recorded
  // Only score/band/action reach the response — signal details never do.
  const now = new Date().toISOString();
  const assessment = scoreFraud(
    await assembleFraudInput({
      phone: form.phone,
      address: form.address,
      paymentMethod: form.paymentMethod,
      totalPoisha: pricing.grandTotalPoisha,
      itemKeys: snapshotItems.map((i) => i.variantId),
      priorOrders,
      now,
    }),
  );
  const enforcement = fraudEnforcement(assessment);
  if (enforcement.blocked) {
    // Generic message only: no signal, list or score details are leaked
    // to the public caller. The idempotency key stays claimed (same
    // pattern as the validation failures above), so a verbatim retry is
    // a 409 conflict rather than a second scoring attempt.
    return errorResponse(
      "FRAUD_BLOCKED",
      "দুঃখিত, এই অর্ডারটি গ্রহণ করা যাচ্ছে না। সহায়তার জন্য আমাদের সাথে যোগাযোগ করুন। / Sorry, this order cannot be accepted. Please contact support for help.",
      422,
    );
  }

  // Reseller attribution (wave 6): the optional ?ref= code captured
  // client-side resolves to an ACTIVE reseller or to nothing — an
  // unknown/ineligible code never fails the order (see
  // resolveResellerAttribution). Resolved before the create so the id
  // is persisted on the Order row in the same transaction.
  const attribution = await resolveResellerAttribution(form.resellerCode);

  // Persist in ONE transaction (see repository.createOrderRecord). A
  // concurrent create with the same key loses the UNIQUE race and comes
  // back as a replay of the winning row.
  const created = await createOrderRecord({
    idempotencyKey: form.idempotencyKey,
    customerName: form.customerName,
    customerPhone: form.phone, // already normalized to +8801XXXXXXXXX by Zod transform
    customerEmail: form.email || undefined,
    address: form.address,
    items: snapshotItems,
    pricing: {
      subtotalPoisha: pricing.subtotalPoisha,
      discountPoisha: pricing.couponDiscountPoisha,
      shippingPoisha: pricing.shippingPoisha,
      codFeePoisha: pricing.codFeePoisha,
      taxPoisha: pricing.taxPoisha,
      totalPoisha: pricing.grandTotalPoisha,
    },
    paymentMethod: form.paymentMethod,
    riskScore: assessment.score, // real scoreFraud() score, 0-100
    resellerId: attribution?.id,
    appliedCoupon:
      coupon.status === "applied" && coupon.code
        ? { code: coupon.code, discountPoisha: coupon.discountPoisha }
        : null,
    note: form.note,
  });
  if (created.replayed) {
    const existing =
      enrichmentByOrderId.get(created.existing.id) ?? orderRowToEnriched(created.existing);
    return NextResponse.json(
      { data: { order: existing, pricing: null }, meta: { idempotentReplay: true, db: "PRISMA" } },
      { status: 200 },
    );
  }

  const order: EnrichedOrder = {
    id: created.orderId,
    orderNo: created.orderNo,
    customerName: form.customerName,
    customerPhone: form.phone,
    address: form.address,
    items: snapshotItems,
    totalPoisha: pricing.grandTotalPoisha,
    paymentMethod: form.paymentMethod,
    paymentStatus: "UNPAID", // non-COD stays UNPAID until the gateway verifies payment
    status: "PENDING",
    ...(attribution ? { resellerId: attribution.id } : {}),
    riskScore: assessment.score,
    riskBand: assessment.level,
    fraudAction: assessment.suggestedAction,
    advanceRequired: enforcement.advanceRequired,
    requiresOtp: enforcement.requiresOtp,
    couponCode: coupon.code,
    couponStatus: coupon.status,
    couponDiscountPoisha: coupon.discountPoisha,
    couponReasonBn: coupon.reasonBn,
    couponReasonEn: coupon.reasonEn,
    tags: [],
    history: [{ from: null, to: "PENDING", changedBy: "customer", changedAt: now }],
    notes: form.note
      ? [{ id: created.noteId ?? created.orderId, author: "customer", text: form.note, createdAt: now }]
      : [],
    createdAt: created.createdAt,
  };
  enrichmentByOrderId.set(order.id, order);
  // order.created is published exactly here — after the transaction
  // commits. The idempotent-replay returns (top) and the FRAUD_BLOCKED
  // return (above) both happen before this line, so neither publishes.
  // Delivery is the in-process bus (src/orders/event-bus); the helper
  // never throws into this mutation path.
  publishOrderCreated(order);
  // Coupon usage is recorded only now that the order exists — never on a
  // fraud block (returned above) and never on an idempotent replay
  // (returned at the top of this handler). (CouponUsage row: written
  // inside the create transaction when the coupon exists in the DB.)
  if (coupon.status === "applied" && coupon.record) {
    recordCouponUse(coupon.record, form.phone);
  }

  return NextResponse.json(
    {
      data: { order, pricing },
      meta: {
        db: "PRISMA",
        source: "DATABASE",
        couponApplied: coupon.status === "applied",
        couponStatus: coupon.status,
        resellerAttributed: attribution !== null,
        fraudScored: true,
        advanceRequired: order.advanceRequired,
        note: "Order persisted to the database (Prisma). Coupon records + fraud lists are DB-backed (marketing/fraud modules); checkout assembles fraud input from DB lists and the coupon lookup from a DB snapshot.",
      },
    },
    { status: 201 },
  );
}

export function GET() {
  return errorResponse("METHOD_NOT_ALLOWED", "Use POST to create an order.", 405);
}
