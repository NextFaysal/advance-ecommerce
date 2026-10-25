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
 *   double-submits inside this process. Wave 20: the claim is RELEASED
 *   on every failure outcome (variant/stock validation, shop rules,
 *   fraud block, create errors) — a corrected retry with the same key
 *   succeeds instead of 409ing on a poisoned claim; only a persisted
 *   order keeps the claim (and replays via the DB lookup above).
 * - Persistence (DB swap): the order is written by
 *   src/orders/repository.createOrderRecord in ONE prisma.$transaction:
 *   Customer find-or-create by phone (+ default Address), Order +
 *   OrderItems (purchase-time snapshots), OrderStatusHistory
 *   (null -> PENDING), Payment row (UNPAID), and a CouponUsage row when
 *   the applied coupon exists as a DB Coupon (@@unique([couponId,
 *   orderId]) backstop). meta.db = "PRISMA".
 * - order.created is published on the in-process bus only after the
 *   transaction commits — never on a replay or a fraud block.
 * - Shipping (wave 20): priced by the shipping engine
 *   (src/checkout/shipping.computeOrderShipping) — the zone is DERIVED
 *   from the submitted district (a customer can no longer self-declare
 *   the cheap Dhaka zone for an outside-Dhaka address), weight slabs
 *   price off the summed Product.weightGrams, and the COD fee is the
 *   engine's configured value. The submitted shippingMethod stays the
 *   fulfilment choice (delivery speed / pickup); on a zone mismatch
 *   the derived zone prices the order and is reported as
 *   meta.shippingZone. Pickup stays pickup (zone "pickup", no
 *   delivery charge).
 * - Shop rules (wave 20, src/checkout/order-rules): Settings-driven
 *   orders.rules.* — minimum merchandise subtotal, COD disabled by
 *   district / category (422 bilingual, names the rule), and a
 *   mandatory-advance flag for large COD orders. All default OFF.
 * - Advance engine (wave 21, plan 17 batch O3): the requirement is
 *   now COMPUTED here as the MAX of the rules threshold percent, the
 *   fraud band's require_advance (same configured percent of the
 *   total), a prepaid method's FULL total, and preorder-line
 *   deposits (Product.preorderDepositPercent) — then PERSISTED on
 *   the Order row by createOrderRecord (advanceRequiredPoisha /
 *   advanceReason / requiresOtp), collected via an auto-issued
 *   payment link (meta.advance), satisfied inside markOrderPayment,
 *   and enforced by the CONFIRMED gate in applyOrderTransition.
 *   Prepaid methods additionally attempt hosted initiation through
 *   src/payments/initiate (O3-2) — the outcome rides in
 *   meta.paymentInitiation and never fails the create.
 * - Order numbers (wave 20): ORD-YYYYMMDD-NNNN per Asia/Dhaka day,
 *   minted inside the create transaction (src/orders/repository).
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
import { checkoutFormSchema, type CheckoutForm } from "@/checkout/validation";
import { computePricing, formatBdt } from "@/checkout/pricing";
import { InMemoryIdempotencyStore } from "@/checkout/idempotency";
import { computeOrderShipping } from "@/checkout/shipping";
import {
  belowMinimum,
  codViolation,
  evaluateAdvanceRule,
  loadOrderRules,
} from "@/checkout/order-rules";
import {
  assembleFraudInput,
  evaluateOrderCoupon,
  fraudEnforcement,
  recordCouponUse,
  type EnrichedOrder,
} from "@/checkout/order-enrichment";
import { scoreFraud } from "@/fraud/scoring";
import {
  ADVANCE_REASON_LABELS,
  issueAdvancePaymentLink,
  percentAdvancePoisha,
  pickAdvanceRequirement,
  type AdvanceCandidate,
} from "@/orders/advance";
import { publishOrderCreated } from "@/orders/event-bus";
import { resolveResellerAttribution } from "@/reseller/store";
import {
  createOrderRecord,
  findOrderByIdempotencyKey,
  getVariantSnapshots,
  listOrdersByPhone,
  orderRowToEnriched,
} from "@/orders/repository";
import { BundleStockError, PreorderCapError, productTypesEnabledInDb } from "@/catalog/product-types";
import type { Order } from "@/orders/types";

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

  // Wave 20: the claim is held only while this attempt can still
  // produce the order. ANY failure outcome from processCreate
  // (400/409/422) — or a throw — means no order was persisted for the
  // key, so the claim is RELEASED and a corrected retry with the same
  // key can succeed; the DB UNIQUE Order.idempotencyKey remains the
  // real guarantee against duplicates. A success (201) or an
  // in-create replay (200) keeps the claim: an order exists for it.
  try {
    const res = await processCreate(form);
    if (res.status >= 400) idempotencyStore.release(form.idempotencyKey);
    return res;
  } catch (err) {
    idempotencyStore.release(form.idempotencyKey);
    throw err;
  }
}

async function processCreate(form: CheckoutForm): Promise<NextResponse> {
  // Server-side re-validation: price, SKU, name, stock from the DB only.
  const serverPrices = await getVariantSnapshots(form.items.map((i) => i.variantId));
  // Wave 15: a BUNDLE variant's sellable count is component-derived
  // (its own stock cache is not the count) — only while the
  // product-types flag is ON, matching the transaction's gate.
  const typesOn = await productTypesEnabledInDb();
  const snapshotItems: Order["items"] = [];
  let subtotalPoisha = 0;
  // Wave 20: the shipping engine prices off the order's total weight,
  // and the COD rules match the items' category slugs — both come
  // from the same server snapshots as price/stock (never the client).
  let totalWeightGrams = 0;
  const categorySlugs = new Set<string>();
  for (const item of form.items) {
    const server = serverPrices.get(item.variantId);
    if (!server) {
      return errorResponse("VARIANT_NOT_FOUND", `Variant not found: ${item.variantId}`, 400);
    }
    const availableStock =
      typesOn && server.productType === "BUNDLE" && server.bundleAvailability !== null
        ? server.bundleAvailability
        : server.stock;
    if (availableStock < item.quantity) {
      return errorResponse(
        "INSUFFICIENT_STOCK",
        `Insufficient stock for ${server.sku}.`,
        400,
        { variantId: item.variantId, sku: server.sku, availableStock, requested: item.quantity },
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
    totalWeightGrams += server.weightGrams * item.quantity;
    categorySlugs.add(server.categorySlug);
  }

  // Shop rules (wave 20, src/checkout/order-rules): Settings-driven
  // policy, every rule default OFF. COD availability is checked
  // against the submitted district + the items' category slugs;
  // violations are a 422 that names the rule, in both languages.
  const rules = await loadOrderRules();
  if (form.paymentMethod === "cod") {
    const violation = codViolation(rules, {
      district: form.address.district,
      categorySlugs: [...categorySlugs],
    });
    if (violation) {
      return errorResponse(
        "COD_NOT_AVAILABLE",
        violation.rule === "orders.rules.cod_disabled_districts"
          ? `এই জেলায় ক্যাশ অন ডেলিভারি (COD) সুবিধা নেই — অনুগ্রহ করে অনলাইন পেমেন্ট বেছে নিন। / Cash on Delivery is not available for the ${form.address.district} district — please choose an online payment method.`
          : "এই অর্ডারের পণ্যের জন্য ক্যাশ অন ডেলিভারি (COD) সুবিধা নেই — অনুগ্রহ করে অনলাইন পেমেন্ট বেছে নিন। / Cash on Delivery is not available for one or more items in this order — please choose an online payment method.",
        422,
        { rule: violation.rule, match: violation.match },
      );
    }
  }
  if (belowMinimum(rules, subtotalPoisha)) {
    return errorResponse(
      "MIN_ORDER_NOT_MET",
      `ন্যূনতম অর্ডার মূল্য ${formatBdt(rules.minOrderPoisha)} — আপনার পণ্যের মূল্য ${formatBdt(subtotalPoisha)}। / Minimum order value is ${formatBdt(rules.minOrderPoisha)} — your items total ${formatBdt(subtotalPoisha)}.`,
      422,
      { rule: "orders.rules.min_order_poisha", minOrderPoisha: rules.minOrderPoisha, subtotalPoisha },
    );
  }

  // The customer's prior orders (real, from the DB) feed both the
  // coupon first-order check and the fraud scorer's history signals.
  const priorOrders = await listOrdersByPhone(form.phone);

  // Coupon: evaluated with the REAL applyCoupon() (see order-enrichment)
  // and applied INSIDE the pricing pipeline at the coupon stage, so the
  // breakdown, the order total and the item snapshots all agree. An
  // ineligible/unknown code does NOT fail the order — discount stays 0
  // and the outcome carries couponStatus "rejected" + the bn/en reason.
  // Shipping (wave 20): the engine derives the zone from the
  // submitted district and prices zone + weight slabs from Settings.
  // The customer's shippingMethod remains the fulfilment choice;
  // where it disagrees with the derived zone, the DERIVED zone prices
  // the order (meta.shippingZone reports it) — pickup is the
  // exception: the pickup choice always stays pickup. The engine
  // returns its configured COD fee verbatim; per its contract the
  // caller (here) applies it to COD orders only.
  const shipping = await computeOrderShipping({
    district: form.address.district,
    shippingMethod: form.shippingMethod,
    totalWeightGrams,
    subtotalPoisha,
  });
  const baseShippingPoisha = shipping.shippingPoisha;
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
    codFeePoisha: form.paymentMethod === "cod" ? shipping.codFeePoisha : 0,
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
    // to the public caller. Wave 20: the wrapper releases the
    // idempotency claim on this 422, so a corrected retry with the
    // same key is scored fresh instead of 409ing on a poisoned claim.
    return errorResponse(
      "FRAUD_BLOCKED",
      "দুঃখিত, এই অর্ডারটি গ্রহণ করা যাচ্ছে না। সহায়তার জন্য আমাদের সাথে যোগাযোগ করুন। / Sorry, this order cannot be accepted. Please contact support for help.",
      422,
    );
  }

  // Mandatory-advance rule (wave 20): a COD order above the configured
  // threshold asks for the configured percent of the grand total.
  const ruleAdvance = evaluateAdvanceRule(rules, {
    paymentMethod: form.paymentMethod,
    grandTotalPoisha: pricing.grandTotalPoisha,
  });

  // Advance engine (wave 21, doc 17 batch O3): the PERSISTED
  // requirement is the MAX of every rule that fires — the winner's
  // bilingual label is stored as advanceReason. Candidates, in
  // tie-break precedence order:
  //   prepaid  — a non-COD gateway method collects the FULL total up
  //              front (nothing is "on delivery" to collect later);
  //   rules    — the wave-20 threshold percent (COD, Settings-driven);
  //   fraud    — the fraud band's require_advance, priced with the
  //              same configured percent of the total;
  //   preorder — deposit percent of each PREORDER line's line total
  //              (Product.preorderDepositPercent, wave-15 terms).
  const advanceCandidates: AdvanceCandidate[] = [];
  if (form.paymentMethod !== "cod") {
    advanceCandidates.push({
      amountPoisha: pricing.grandTotalPoisha,
      reason: ADVANCE_REASON_LABELS.prepaid,
    });
  }
  if (ruleAdvance.advanceRequired) {
    advanceCandidates.push({
      amountPoisha: ruleAdvance.advancePoisha,
      reason: ADVANCE_REASON_LABELS.rules,
    });
  }
  if (enforcement.advanceRequired) {
    advanceCandidates.push({
      amountPoisha: percentAdvancePoisha(pricing.grandTotalPoisha, rules.advancePercent),
      reason: ADVANCE_REASON_LABELS.fraud_review,
    });
  }
  let preorderDepositPoisha = 0;
  for (const item of form.items) {
    const server = serverPrices.get(item.variantId);
    if (server && server.productType === "PREORDER" && server.preorderDepositPercent) {
      preorderDepositPoisha += Math.round(
        (server.unitPricePoisha * item.quantity * server.preorderDepositPercent) / 100,
      );
    }
  }
  if (preorderDepositPoisha > 0) {
    advanceCandidates.push({
      amountPoisha: preorderDepositPoisha,
      reason: ADVANCE_REASON_LABELS.preorder_deposit,
    });
  }
  const advanceRequirement = pickAdvanceRequirement(advanceCandidates);

  // Reseller attribution (wave 6): the optional ?ref= code captured
  // client-side resolves to an ACTIVE reseller or to nothing — an
  // unknown/ineligible code never fails the order (see
  // resolveResellerAttribution). Resolved before the create so the id
  // is persisted on the Order row in the same transaction.
  const attribution = await resolveResellerAttribution(form.resellerCode);

  // Persist in ONE transaction (see repository.createOrderRecord). A
  // concurrent create with the same key loses the UNIQUE race and comes
  // back as a replay of the winning row. Wave 15 product-type failures
  // (bundle component stock, preorder cap) roll the create back and are
  // mapped to honest client errors here instead of a 500.
  let created: Awaited<ReturnType<typeof createOrderRecord>>;
  try {
    created = await createOrderRecord({
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
    // Wave 21: the persisted advance requirement + OTP flag — the
    // CONFIRMED gate and markOrderPayment read these columns.
    advanceRequiredPoisha: advanceRequirement.advanceRequiredPoisha,
    advanceReason: advanceRequirement.advanceReason ?? undefined,
    requiresOtp: enforcement.requiresOtp,
    resellerId: attribution?.id,
    appliedCoupon:
      coupon.status === "applied" && coupon.code
        ? { code: coupon.code, discountPoisha: coupon.discountPoisha }
        : null,
    note: form.note,
    });
  } catch (err) {
    if (err instanceof BundleStockError) {
      return errorResponse("INSUFFICIENT_STOCK", err.message, 400, err.details);
    }
    if (err instanceof PreorderCapError) {
      return errorResponse("PREORDER_CAP_REACHED", err.message, 409, err.details);
    }
    throw err;
  }
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
    // Wave 21: the persisted engine truth (any source rule, incl.
    // prepaid full-total and preorder deposits), not just fraud/rules.
    advanceRequired: advanceRequirement.advanceRequiredPoisha > 0,
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

  // Advance collection (wave 21, doc 17 batch O3): a fresh order with
  // a persisted requirement and nothing paid yet gets a payment link
  // for exactly the advance amount, via the EXISTING link module
  // (src/bd/payment-link — only the token hash is stored; the plain
  // token + URL ride in meta.advance exactly once). A failure returns
  // null and the meta carries the amount + reason only — no fake link.
  const advanceLink =
    advanceRequirement.advanceRequiredPoisha > 0
      ? await issueAdvancePaymentLink(created.orderId, advanceRequirement.advanceRequiredPoisha)
      : null;

  // OTP first issue (wave 21, O3-2 seam): an order the enforcement
  // flagged requiresOtp gets its first code issued + queued for SMS
  // right away — without this the confirm gate would block forever
  // with no code ever sent. Same degrade-to-meta discipline as the
  // initiation below: a failure never breaks the committed create,
  // and meta.otp is honest — "queued" is NOT "delivered" (delivery
  // needs the VPS worker + a live SMS provider).
  let otpMeta: { required: true; sms: string } | undefined;
  if (enforcement.requiresOtp) {
    try {
      const otp = await import("@/orders/otp");
      const issued = await otp.issueOrderOtp(created.orderId);
      const sent = await otp.sendOrderOtpSms(created.orderId, issued.code);
      otpMeta = { required: true, sms: sent.enqueued ? "queued" : (sent.reason ?? "queue-unavailable") };
    } catch {
      otpMeta = { required: true, sms: "issue_failed" };
    }
  }

  // Abandoned-checkout recovery (wave 22, doc 17 batch O4): when this
  // checkout session had a capture row, the completed order closes it
  // (OPEN -> RECOVERED with this order's id). Guarded dynamic import +
  // try/catch, same discipline as the seams around it — a failure here
  // must never break a create that already committed.
  if (form.checkoutSessionKey) {
    try {
      const abandoned = await import("@/checkout/abandoned");
      await abandoned.markAbandonedCheckoutRecovered(form.checkoutSessionKey, created.orderId);
    } catch {
      // The capture simply stays OPEN and ages off the admin list at
      // expiry — no customer-facing impact.
    }
  }

  // Prepaid initiation (O3-2 seam): a non-COD order also attempts the
  // hosted-payment initiation. Dynamic import + try/catch by design —
  // its absence (or failure) degrades to meta, never breaks a create
  // that already committed. The function itself never throws either.
  let paymentInitiation: { status: string; url?: string; provider?: string; message?: string } | undefined;
  if (form.paymentMethod !== "cod") {
    try {
      const mod = (await import("@/payments/initiate")) as {
        initiatePrepaidPayment?: (order: {
          id: string;
          orderNo: string;
          totalPoisha: number;
          paymentMethod: string;
          customerPhone: string;
        }) => Promise<{ status: string; url?: string; provider?: string; message?: string }>;
      };
      paymentInitiation =
        typeof mod.initiatePrepaidPayment === "function"
          ? await mod.initiatePrepaidPayment({
              id: created.orderId,
              orderNo: created.orderNo,
              totalPoisha: pricing.grandTotalPoisha,
              paymentMethod: form.paymentMethod,
              customerPhone: form.phone,
            })
          : { status: "not_wired" };
    } catch {
      paymentInitiation = { status: "not_wired" };
    }
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
        // Wave 20 compat: advancePoisha now reports the PERSISTED
        // requirement (any source rule); advanceRule is present when
        // the rules threshold was the winning source.
        ...(advanceRequirement.advanceRequiredPoisha > 0
          ? { advancePoisha: advanceRequirement.advanceRequiredPoisha }
          : {}),
        ...(advanceRequirement.advanceReason === ADVANCE_REASON_LABELS.rules
          ? { advanceRule: "orders.rules.advance_required_above_poisha" }
          : {}),
        // Wave 21: the full advance block — required amount, the
        // winning rule's label, and the one-time payment link when
        // issuing succeeded (linkUrl/linkToken absent when it didn't).
        ...(advanceRequirement.advanceRequiredPoisha > 0
          ? {
              advance: {
                requiredPoisha: advanceRequirement.advanceRequiredPoisha,
                reason: advanceRequirement.advanceReason,
                ...(advanceLink ? { linkUrl: advanceLink.url, linkToken: advanceLink.plainToken } : {}),
              },
            }
          : {}),
        ...(paymentInitiation ? { paymentInitiation } : {}),
        ...(otpMeta ? { otp: otpMeta } : {}),
        shippingZone: shipping.zone,
        freeShippingApplied: shipping.freeShippingApplied,
        note: "Order persisted to the database (Prisma). Coupon records + fraud lists are DB-backed (marketing/fraud modules); checkout assembles fraud input from DB lists and the coupon lookup from a DB snapshot.",
      },
    },
    { status: 201 },
  );
}

export function GET() {
  return errorResponse("METHOD_NOT_ALLOWED", "Use POST to create an order.", 405);
}
