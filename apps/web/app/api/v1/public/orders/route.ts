/**
 * POST /api/v1/public/orders — public order create.
 *
 * CONTRACT (consistent API format):
 *   success: { data: { order, pricing }, meta: {...} }
 *   error:   { error: { code, message, details } }
 *
 * REAL, already wired in this file:
 * - Zod validation on every input (checkoutFormSchema: phone required,
 *   BD regex, normalized to +8801XXXXXXXXX, email optional, address
 *   Division > District > Upazila > Union, items >= 1, UUID idempotencyKey)
 * - Server-side price re-validation: client sends NO price. Prices, SKU,
 *   product name and stock are taken from the SERVER price source below.
 *   A client total is never trusted.
 * - Pricing pipeline, integer poisha only: subtotal -> coupon -> shipping
 *   -> COD fee -> tax (0 bps for now) -> grand total.
 * - Coupon (Agent 59): a submitted couponCode is evaluated with the REAL
 *   applyCoupon() (src/marketing/service) via src/checkout/
 *   order-enrichment and applied INSIDE the pipeline at the coupon stage.
 *   An ineligible/unknown code never fails the order: it is created with
 *   a 0 discount and couponStatus "rejected" + the bn/en reason.
 * - Fraud (Agent 59): every create is scored with the REAL scoreFraud()
 *   (src/fraud) over the demo list store + this route's in-memory order
 *   history. Suggested action "block" -> 422 FRAUD_BLOCKED (generic
 *   message, no signal details leave the server); "require_advance" ->
 *   the order is created flagged advanceRequired + requiresOtp. The real
 *   score/band/action are stored on the order record.
 * - Idempotency: a duplicate idempotencyKey returns the ORIGINAL order
 *   (with its original coupon/fraud results — a replay never re-applies
 *   a coupon or re-scores), never a second order. The in-memory claim
 *   below is TEMPORARY ONLY.
 *
 * TEMPORARY MOCK / NOT YET WIRED — do not present as a real DB:
 * - SERVER_PRICES comes from src/catalog/mock.ts (TEMPORARY MOCK data).
 *   Replace with a Prisma ProductVariant query once Agent 6 merges the
 *   Order/Cart schema (orders/SCHEMA-ADDITIONS.md) and Prisma generate
 *   succeeds. The current Prisma schema has NO Order/OrderItem tables yet.
 * - Created orders live in a module-level in-memory array only: lost on
 *   restart, NOT shared with admin routes, NOT a database.
 * - The real DB transaction is documented in createOrderTransactionSteps()
 *   and must be implemented as prisma.$transaction once the schema lands:
 *     1. re-validate variant prices + stock (SELECT ... FOR UPDATE / stock check)
 *     2. enforce UNIQUE idempotencyKey (return existing order on conflict)
 *     3. create Order + OrderItems (purchase-time price/SKU/name snapshots)
 *     4. create OrderStatusHistory (null -> PENDING)
 *     5. reserve stock via stock_movements ledger (reserve at checkout)
 *     6. create Payment row (UNPAID for COD / until gateway verifies)
 *     7. emit order.created event (in-process bus now — see the publish
 *        call after the store push; Redis pub/sub once the DB lands)
 *   Until then this route returns meta.db = "NOT_WIRED" so no caller can
 *   mistake a mock order for a persisted order.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { MOCK_PRODUCTS } from "@/catalog/mock";
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
import type { Order } from "@/orders/types";

type ServerVariant = {
  variantId: string;
  productName: string;
  sku: string;
  unitPricePoisha: number;
  stock: number;
};

// TEMPORARY MOCK server price source — see header. Replace with Prisma.
const SERVER_PRICES = new Map<string, ServerVariant>();
for (const product of MOCK_PRODUCTS) {
  for (const variant of product.variants) {
    SERVER_PRICES.set(variant.id, {
      variantId: variant.id,
      productName: product.title.en,
      sku: variant.sku,
      unitPricePoisha: variant.pricePoisha,
      stock: variant.stock,
    });
  }
}

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

// TEMPORARY in-memory order store + idempotency store — NOT a DB.
// Records are EnrichedOrder: the base Order plus the real coupon outcome
// and fraud assessment fields wired by Agent 59 (order-enrichment.ts).
const TEMPORARY_ORDERS: EnrichedOrder[] = [];
const idempotencyStore = new InMemoryIdempotencyStore();
const idempotencyOrderIds = new Map<string, string>();

export function createOrderTransactionSteps(): string[] {
  return [
    "1. Re-validate variant prices + stock from DB (server source only, never client prices)",
    "2. Enforce UNIQUE idempotencyKey — on conflict return the existing order",
    "3. prisma.$transaction: create Order + OrderItems (price/SKU/name snapshots)",
    "4. prisma.$transaction: create OrderStatusHistory (null -> PENDING)",
    "5. prisma.$transaction: reserve stock via stock_movements ledger",
    "6. prisma.$transaction: create Payment row (UNPAID until gateway verifies)",
    "7. Emit order.created event (in-process bus today -> /api/v1/admin/orders/feed; Redis pub/sub after DB wiring)",
  ];
}

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

  // Idempotency FIRST: duplicate key returns the original order, never a second one.
  if (idempotencyOrderIds.has(form.idempotencyKey)) {
    const existing = TEMPORARY_ORDERS.find((o) => o.id === idempotencyOrderIds.get(form.idempotencyKey));
    if (existing) {
      return NextResponse.json(
        { data: { order: existing, pricing: null }, meta: { idempotentReplay: true, db: "NOT_WIRED" } },
        { status: 200 },
      );
    }
  }
  if (!idempotencyStore.claim(form.idempotencyKey)) {
    return errorResponse("IDEMPOTENCY_CONFLICT", "This checkout attempt was already processed.", 409);
  }

  // Server-side re-validation: price, SKU, name, stock from SERVER_PRICES only.
  const snapshotItems: Order["items"] = [];
  let subtotalPoisha = 0;
  for (const item of form.items) {
    const server = SERVER_PRICES.get(item.variantId);
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

  // Coupon: evaluated with the REAL applyCoupon() (see order-enrichment)
  // and applied INSIDE the pricing pipeline at the coupon stage, so the
  // breakdown, the order total and the item snapshots all agree. An
  // ineligible/unknown code does NOT fail the order — discount stays 0
  // and the outcome carries couponStatus "rejected" + the bn/en reason.
  const baseShippingPoisha = shippingPoisha(form.shippingMethod);
  const priorOrders = TEMPORARY_ORDERS.filter((o) => o.customerPhone === form.phone);
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
    assembleFraudInput({
      phone: form.phone,
      address: form.address,
      paymentMethod: form.paymentMethod,
      totalPoisha: pricing.grandTotalPoisha,
      itemKeys: snapshotItems.map((i) => i.variantId),
      priorOrders: TEMPORARY_ORDERS,
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

  const order: EnrichedOrder = {
    id: crypto.randomUUID(),
    orderNo: `ORD-${Date.now()}`,
    customerName: form.customerName,
    customerPhone: form.phone, // already normalized to +8801XXXXXXXXX by Zod transform
    address: form.address,
    items: snapshotItems,
    totalPoisha: pricing.grandTotalPoisha,
    paymentMethod: form.paymentMethod,
    paymentStatus: "UNPAID", // non-COD stays UNPAID until the gateway verifies payment
    status: "PENDING",
    riskScore: assessment.score, // real scoreFraud() score, 0-100
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
    notes: form.note ? [{ id: crypto.randomUUID(), author: "customer", text: form.note, createdAt: now }] : [],
    createdAt: now,
  };

  // TEMPORARY MOCK persistence only — see header. Real write = prisma.$transaction.
  TEMPORARY_ORDERS.push(order);
  idempotencyOrderIds.set(form.idempotencyKey, order.id);
  // order.created is published exactly here — the single create funnel.
  // The idempotent-replay return (top) and the FRAUD_BLOCKED return
  // (above) both happen before this line, so neither re-publishes.
  // Delivery is the in-process bus (src/orders/event-bus); the helper
  // never throws into this mutation path.
  publishOrderCreated(order);
  // Coupon usage is recorded only now that the order exists — never on a
  // fraud block (returned above) and never on an idempotent replay
  // (returned at the top of this handler).
  if (coupon.status === "applied" && coupon.record) {
    recordCouponUse(coupon.record, form.phone);
  }

  return NextResponse.json(
    {
      data: { order, pricing },
      meta: {
        db: "NOT_WIRED",
        source: "TEMPORARY_MOCK_STORE",
        transactionSteps: createOrderTransactionSteps(),
        couponApplied: coupon.status === "applied",
        couponStatus: coupon.status,
        fraudScored: true,
        advanceRequired: order.advanceRequired,
        note: "Order is NOT persisted to a database yet (in-memory demo store). Coupon + fraud scoring above are the real services; persistence awaits Prisma.",
      },
    },
    { status: 201 },
  );
}

export function GET() {
  return errorResponse("METHOD_NOT_ALLOWED", "Use POST to create an order.", 405);
}

void z;
