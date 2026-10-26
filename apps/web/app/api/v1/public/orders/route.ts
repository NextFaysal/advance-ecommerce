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
 * - Delivery slot + gift (wave 27, doc 17 batch O9-2): an optional
 *   deliverySlotId is resolved against Settings orders.delivery_slots
 *   (src/checkout/delivery-slots) and the canonical id persisted on
 *   Order.deliverySlot; the gift message persists verbatim on
 *   Order.giftMessage. Neither affects pricing — no slot fee and no
 *   gift-wrap fee exist.
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
import { findDeliverySlot, loadDeliverySlots } from "@/checkout/delivery-slots";
import {
  ageAttestationNoteText,
  evaluateAgeGate,
  loadAgeRestrictions,
} from "@/catalog/age-restrictions";
import { findPickupPoint, loadPickupPoints, pickupChoiceNoteText } from "@/checkout/pickup-points";
import { isPackEnabled } from "@/business-modules/packs";
import {
  checkPrescriptionGate,
  getVariantRxMap,
  loadPharmacyConfig,
  orderHasRxItems,
  prescriptionNoteText,
  tagOrderRxPending,
} from "@/business-modules/pharmacy-orders";
import { getWarrantyTermsForCategories } from "@/business-modules/electronics-warranty";
import { BundleStockError, PreorderCapError, productTypesEnabledInDb } from "@/catalog/product-types";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  GiftCardRedemptionError,
  validateGiftCardForCheckout,
  type GiftCardValidation,
} from "@/marketing/gift-cards";
import {
  deriveMembershipTier,
  lifetimeDeliveredSpendPoisha,
  loadMembershipTierConfig,
  tierDiscountForBasePoisha,
} from "@/marketing/membership-tiers";
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
  // ADV-18: a checkout attempt carrying a gift-card code is the ONLY
  // public validation surface for codes (there is deliberately no
  // standalone balance-oracle endpoint), so attempts are
  // rate-limited per IP+phone — a gift-card code is a bearer
  // instrument and guessing must be expensive. Runs before the
  // idempotency claim so a limited attempt never poisons the key;
  // only when the module flag is on (off = the code is ignored).
  if (form.giftCardCode && isFeatureEnabled("module.marketing_mechanics")) {
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
    const limit = await checkRateLimit(`gift-card-checkout:${ip}:${form.phone}`, 10, 60 * 60 * 1000);
    if (!limit.allowed) {
      return errorResponse(
        "RATE_LIMITED",
        "অনেকবার গিফট কার্ড যাচাইয়ের চেষ্টা হয়েছে — কিছুক্ষণ পরে আবার চেষ্টা করুন। / Too many gift-card attempts — please try again later.",
        429,
      );
    }
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

  // Age gate (ADV-29): re-derived from the SAME server snapshots'
  // category slugs (never the client) against Settings
  // catalog.age_restricted_categories. A restricted cart without an
  // attestation is REFUSED (400 AGE_ATTESTATION_REQUIRED) — there
  // is no bypass; with one, the attestation rides the create-time
  // note (below). The record is a SELF-DECLARATION, not age or
  // identity verification — the note text says so verbatim
  // (src/catalog/age-restrictions.ts).
  const ageGate = evaluateAgeGate(
    categorySlugs,
    await loadAgeRestrictions(),
    form.ageAttestation?.confirmed === true,
  );
  if (ageGate.required && !ageGate.ok) {
    return errorResponse(
      "AGE_ATTESTATION_REQUIRED",
      `এই অর্ডারে বয়স-সীমাবদ্ধ পণ্য আছে — অর্ডার করতে বয়স নিশ্চিতকরণ (কমপক্ষে ${ageGate.minAge} বছর) আবশ্যক। / This order contains an age-restricted item — an age attestation (at least ${ageGate.minAge} years old) is required to place it.`,
      400,
      { minAge: ageGate.minAge },
    );
  }

  // Pharmacy gate (ADV-22): when the pharmacy pack is on, the
  // requirement is re-derived from DB product tags (never the
  // client): an order containing a prescription-required item is
  // REFUSED without a prescription record — the pack's own
  // validatePharmacyCheckout, no bypass. The record itself rides the
  // create-time note (below) and, when the pack requires pharmacist
  // review, the order enters the verification queue post-commit and
  // cannot be CONFIRMED until approved (the gate lives in
  // applyOrderTransition). The record is a customer attestation, NOT
  // a verified prescription — the note text says so verbatim.
  let rxOrder: { reviewRequired: boolean } | null = null;
  if (isPackEnabled("pharmacy")) {
    const pharmacyConfig = await loadPharmacyConfig();
    const rxMap = await getVariantRxMap(
      form.items.map((i) => i.variantId),
      pharmacyConfig,
    );
    if (orderHasRxItems(rxMap, form.items.map((i) => i.variantId))) {
      const gate = checkPrescriptionGate(
        form.items.map((i) => ({
          variantId: i.variantId,
          requiresPrescription: rxMap.get(i.variantId) === true,
        })),
        form.prescription ?? null,
      );
      if (!gate.ok) {
        return errorResponse(
          "PRESCRIPTION_REQUIRED",
          "এই অর্ডারে প্রেসক্রিপশন-আবশ্যক পণ্য আছে — অর্ডার করতে প্রেসক্রিপশনের তথ্য (চিকিৎসকের নাম ও রেজিস্ট্রেশন নম্বর) দিন। / This order contains a prescription-required item — please provide the prescription record (prescriber name and registration number) to place the order.",
          400,
          gate.errors,
        );
      }
      rxOrder = { reviewRequired: pharmacyConfig.pharmacistReviewRequired };
    }
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

  // ADV-18 marketing mechanics (flag module.marketing_mechanics):
  // membership tier + gift card, applied in this same pricing seam.
  // Tier: derived from the customer's lifetime DELIVERED spend (the
  // priorOrders rows already loaded above); its discount lands in
  // the pipeline's discount stage next to the coupon, and a
  // free-shipping tier zeroes the shipping charge for THIS order's
  // pricing (the coupon evaluation above keeps the engine price — a
  // shipping-scoped coupon still sees the real charge). Gift card:
  // validated read-only against the pre-gift total; the authoritative
  // re-check + REDEEM write happen under a row lock inside the
  // create transaction (createOrderRecord). A code that fails
  // validation never fails the order — it is reported in
  // meta.giftCard and the order proceeds at full price.
  const marketingOn = isFeatureEnabled("module.marketing_mechanics");
  let tierDiscountPoisha = 0;
  let tierFreeShipping = false;
  let tierKey: string | null = null;
  if (marketingOn) {
    const tierState = deriveMembershipTier(
      lifetimeDeliveredSpendPoisha(priorOrders),
      await loadMembershipTierConfig(),
    );
    tierKey = tierState.tier.key;
    tierDiscountPoisha = tierDiscountForBasePoisha(
      Math.max(0, subtotalPoisha - coupon.discountPoisha),
      tierState.tier,
    );
    tierFreeShipping = tierState.tier.freeShipping;
  }
  const effectiveShippingPoisha = tierFreeShipping ? 0 : coupon.shippingPoisha;
  const pricingInput = {
    itemsSubtotalPoisha: subtotalPoisha,
    couponDiscountPoisha: coupon.discountPoisha,
    tierDiscountPoisha,
    shippingPoisha: effectiveShippingPoisha,
    codFeePoisha: form.paymentMethod === "cod" ? shipping.codFeePoisha : 0,
    taxBps: 0,
  };
  const preGiftPricing = computePricing(pricingInput);
  let giftCardValidation: GiftCardValidation | null = null;
  let pricing = preGiftPricing;
  if (marketingOn && form.giftCardCode) {
    giftCardValidation = await validateGiftCardForCheckout(
      form.giftCardCode,
      preGiftPricing.grandTotalPoisha,
    );
    if (giftCardValidation.ok && giftCardValidation.applicablePoisha > 0) {
      pricing = computePricing({
        ...pricingInput,
        giftCardAppliedPoisha: giftCardValidation.applicablePoisha,
      });
    }
  }

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

  // Delivery slot + gift (wave 27, doc 17 batch O9-2): the submitted
  // slot id is resolved against the configured set (Settings
  // orders.delivery_slots) — only a match is persisted, as the slot
  // id on Order.deliverySlot; an unknown id (stale page, renamed
  // slots) is dropped and reported via meta.deliverySlotAccepted so
  // the create never fails over a display preference. The gift
  // message persists verbatim ("" = gift requested, no message);
  // there is NO gift-wrap fee.
  const deliverySlot = findDeliverySlot(await loadDeliverySlots(), form.deliverySlotId);
  const giftMessage = form.giftMessage !== undefined ? form.giftMessage.trim() : undefined;

  // Pickup point (ADV-19, click & collect): resolved ONLY for pickup
  // orders, against Settings stores.pickup_points. Order has no
  // pickupPoint column, so a match is recorded in the create-time
  // OrderNote (name + address frozen at order time, plus the
  // `[pickup:<id>]` marker the admin list badge scans for) — appended
  // to the customer's own note when they wrote one. An unknown id is
  // dropped and reported via meta.pickupPointAccepted; the create
  // never fails over it.
  const pickupPoint =
    form.shippingMethod === "pickup"
      ? findPickupPoint(await loadPickupPoints(), form.pickupPointId)
      : null;
  const createNote =
    [
      form.note,
      pickupPoint ? pickupChoiceNoteText(pickupPoint) : null,
      // ADV-22: the prescription record rides the same create-time
      // note seam (human lines + the [rx-record] machine line the
      // pharmacist queue parses back). Present only when the order
      // actually contains Rx items and the gate accepted the record.
      rxOrder && form.prescription ? prescriptionNoteText(form.prescription) : null,
      // ADV-29: the age attestation rides the same create-time note
      // seam — present only when the cart was age-restricted and the
      // gate accepted the customer's self-declaration.
      ageGate.required && ageGate.minAge !== null ? ageAttestationNoteText(ageGate.minAge) : null,
    ]
      .filter((part): part is string => typeof part === "string" && part.trim() !== "")
      .join("\n") || undefined;

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
      // ADV-18: the Order row's discount column carries coupon + tier
      // discount combined (both are merchandise discounts from the
      // pipeline's discount stage; the split stays visible in the
      // response pricing breakdown + meta).
      discountPoisha: pricing.couponDiscountPoisha + pricing.tierDiscountPoisha,
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
    // Wave 27: persisted slot id + gift message (see above).
    deliverySlot: deliverySlot?.id,
    giftMessage,
    resellerId: attribution?.id,
    appliedCoupon:
      coupon.status === "applied" && coupon.code
        ? { code: coupon.code, discountPoisha: coupon.discountPoisha }
        : null,
    // ADV-18: the redemption the create transaction must record
    // (re-validated under the card row lock in there). Null when no
    // code was submitted, the module is off, or validation rejected
    // the code — the order then simply carries no redemption.
    giftCardRedemption:
      giftCardValidation?.ok && pricing.giftCardAppliedPoisha > 0
        ? {
            cardId: giftCardValidation.cardId,
            amountPoisha: pricing.giftCardAppliedPoisha,
            codeLast4: giftCardValidation.codeLast4,
          }
        : null,
    note: createNote,
    });
  } catch (err) {
    if (err instanceof BundleStockError) {
      return errorResponse("INSUFFICIENT_STOCK", err.message, 400, err.details);
    }
    if (err instanceof PreorderCapError) {
      return errorResponse("PREORDER_CAP_REACHED", err.message, 409, err.details);
    }
    // ADV-18: the gift card passed read-only validation but failed
    // the in-transaction re-check (balance raced down, card disabled
    // mid-checkout). The create rolled back in full — no order, no
    // charge — and the wrapper releases the idempotency claim on
    // this 422 so the customer can retry (with or without the card).
    if (err instanceof GiftCardRedemptionError) {
      return errorResponse(
        "GIFT_CARD_REJECTED",
        "গিফট কার্ডটি ব্যবহার করা যায়নি — অর্ডারটি তৈরি হয়নি, অনুগ্রহ করে আবার চেষ্টা করুন। / The gift card could not be redeemed — the order was not created, please try again.",
        422,
        { giftCardError: err.code },
      );
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
    // Wave 27: the persisted slot + gift, mirrored on the response
    // order so the confirmation screen agrees with the stored row.
    ...(deliverySlot ? { deliverySlot: deliverySlot.id } : {}),
    ...(giftMessage !== undefined ? { giftMessage } : {}),
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
    notes: createNote
      ? [{ id: created.noteId ?? created.orderId, author: "customer", text: createNote, createdAt: now }]
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

  // v2-merge (PR #1): the branch dispatched its own direct-send OTP
  // challenge here (src/checkout/otp.ts). Removed — main already
  // issues and sends the order OTP a few lines below via
  // src/orders/otp (issueOrderOtp + sendOrderOtpSms, queue-backed,
  // verified by the [id]/otp routes + OrderOtpPanel). Running both
  // would text the customer two different codes.

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

  // Pharmacy verification queue (ADV-22): an Rx order whose pack
  // config requires pharmacist review is stamped rx:pending — the
  // stamp is what the admin queue lists and what the CONFIRMED gate
  // blocks on. Guarded like the seams around it: the create already
  // committed; a failed stamp leaves the prescription record on the
  // order note (staff can still see it) and is retried by no one —
  // the order simply is not queue-blocked, which the meta does not
  // claim otherwise (reviewStatus below reports the stamp outcome).
  let rxStamped = false;
  if (rxOrder?.reviewRequired) {
    try {
      await tagOrderRxPending(created.orderId);
      rxStamped = true;
    } catch {
      rxStamped = false;
    }
  }
  const rxMeta = rxOrder
    ? {
        hasRxItems: true,
        reviewRequired: rxOrder.reviewRequired,
        reviewStatus: rxOrder.reviewRequired
          ? rxStamped
            ? "PENDING_REVIEW"
            : "RECORD_ONLY"
          : "NOT_REQUIRED",
      }
    : null;

  // Electronics warranty terms (ADV-22): the confirmation shows the
  // warranty period per electronics-pack category in this order —
  // terms only (serials are allocated at delivery and appear on the
  // account warranty card then). Starts-at-delivery is stated on the
  // confirmation surface itself.
  const warrantyTerms = isPackEnabled("electronics")
    ? await getWarrantyTermsForCategories([...categorySlugs])
    : [];

  // Order-confirmation email (ADV-3): when the customer gave an email,
  // a confirmation job is enqueued on the email-send queue — same
  // guarded seam discipline as the blocks around it. meta.email is
  // honest: "queued" means the job sits in Redis; delivery still
  // needs the worker process AND a configured email transport
  // (Settings email.*) — until then the job waits / skips, and no
  // email is ever claimed sent here. Phone-only orders (no email)
  // skip the seam entirely and carry no meta.email.
  let emailMeta: { confirmation: string } | undefined;
  if (form.email !== undefined && form.email !== "") {
    try {
      const email = await import("@/email/send");
      const result = await email.enqueueOrderConfirmationEmail(created.orderId);
      emailMeta = {
        confirmation: result.email === "queued" ? "queued" : result.reason,
      };
    } catch {
      emailMeta = { confirmation: "queue-unavailable" };
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

  // ADV-18 gift-card outcome for the confirmation screen: present
  // whenever a code was submitted. "applied" carries the exact
  // ledger outcome — remainingPoisha is the balance the create
  // transaction itself derived under the card lock, not the earlier
  // read-only estimate. "rejected" means validation refused the code
  // and the order proceeded at full price; "disabled" means the
  // module flag is off and the code was never consulted.
  const giftCardMeta = !form.giftCardCode
    ? undefined
    : !marketingOn
      ? { status: "disabled" as const }
      : giftCardValidation?.ok
        ? {
            status: "applied" as const,
            appliedPoisha: pricing.giftCardAppliedPoisha,
            codeLast4: giftCardValidation.codeLast4,
            remainingPoisha:
              created.giftCardBalanceAfterPoisha ??
              giftCardValidation.balancePoisha - pricing.giftCardAppliedPoisha,
          }
        : {
            status: "rejected" as const,
            reason: giftCardValidation?.reason ?? "NOT_FOUND",
            reasonBn: giftCardValidation?.reasonBn ?? "",
            reasonEn: giftCardValidation?.reasonEn ?? "",
          };

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
        ...(emailMeta ? { email: emailMeta } : {}),
        // Wave 27: deliverySlotAccepted is present only when the
        // customer submitted a slot id — false means the id was not
        // in the configured set and was dropped (order unaffected).
        ...(form.deliverySlotId !== undefined
          ? { deliverySlotAccepted: deliverySlot !== null }
          : {}),
        // ADV-19: pickupPointAccepted is present only when a pickup
        // order submitted a point id — false means the id was not in
        // the configured set and was dropped (order unaffected).
        // pickupPoint carries the resolved point for the confirmation
        // screen's "collect from" display.
        ...(form.shippingMethod === "pickup" && form.pickupPointId !== undefined
          ? { pickupPointAccepted: pickupPoint !== null }
          : {}),
        ...(pickupPoint
          ? {
              pickupPoint: {
                id: pickupPoint.id,
                name: pickupPoint.name,
                address: pickupPoint.address,
                hours: pickupPoint.hours,
              },
            }
          : {}),
        shippingZone: shipping.zone,
        freeShippingApplied: shipping.freeShippingApplied,
        // ADV-18: membership-tier outcome (present when the module is
        // on) + the gift-card outcome (present when a code was sent).
        ...(marketingOn
          ? {
              membershipTier: {
                tier: tierKey,
                discountPoisha: pricing.tierDiscountPoisha,
                freeShippingApplied: tierFreeShipping && coupon.shippingPoisha > 0,
              },
            }
          : {}),
        ...(giftCardMeta ? { giftCard: giftCardMeta } : {}),
        // ADV-22: pharmacy outcome (present only for Rx orders) +
        // electronics warranty terms for the confirmation screen.
        ...(rxMeta ? { pharmacyRx: rxMeta } : {}),
        // ADV-29: age-gate outcome (present only for restricted carts).
        ...(ageGate.required
          ? { ageGate: { required: true, minAge: ageGate.minAge, attested: true } }
          : {}),
        ...(warrantyTerms.length > 0 ? { warrantyTerms } : {}),
        note: "Order persisted to the database (Prisma). Coupon records + fraud lists are DB-backed (marketing/fraud modules); checkout assembles fraud input from DB lists and the coupon lookup from a DB snapshot.",
      },
    },
    { status: 201 },
  );
}

export function GET() {
  return errorResponse("METHOD_NOT_ALLOWED", "Use POST to create an order.", 405);
}
