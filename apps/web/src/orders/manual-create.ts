/**
 * Shared manual-order create service — doc 17 batch O4 (wave 22).
 *
 * This is the manual/staff create pipeline extracted VERBATIM (in
 * behaviour) from the admin orders route, where it previously lived
 * inside the route handler and could not be reused. Callers:
 *   - POST /api/v1/admin/orders (manual branch) — the original route;
 *     it now only authenticates, validates, delegates, and maps the
 *     result onto its historical response shape.
 *   - POST /api/v1/admin/inbox/conversations/[id]/convert-to-order —
 *     source "inbox", internalNote naming the conversation.
 *   - POST /api/v1/admin/orders/import — CSV bulk import, one call
 *     per customer group (each call is its own create transaction).
 *   - The abandoned-checkout conversion (batch O4-1) uses the same
 *     contract with its own source label.
 *
 * CONTRACT
 *   createManualOrder(input, actor): Promise<ManualCreateResult>
 *   - input mirrors manualOrderSchema (src/orders/manual-order) plus
 *     the route-level extensions the admin endpoint already accepted
 *     (idempotencyKey, resellerCode, advanceRequiredPoisha) plus:
 *       source?: string       — Order.source label; default "manual".
 *       internalNote?: string — extra line prepended to the order
 *                               note (e.g. the inbox conversation id).
 *       deliverySlotId?/giftMessage? (wave 27, O9-2, ADDITIVE) —
 *                               declared on manualOrderSchema itself;
 *                               the slot id is re-resolved against
 *                               Settings orders.delivery_slots here
 *                               and both persist on the Order columns
 *                               public checkout writes. Draft-order
 *                               conversion enters through this same
 *                               contract, so a stored draft payload is
 *                               re-validated here, never trusted.
 *       advanceLinkPolicy? (doc 18 F3, ADDITIVE) — "issue" (default)
 *                               creates the advance payment link as
 *                               before; "suppress" creates NO link,
 *                               for callers that credit the advance
 *                               themselves immediately after create
 *                               (preorder fulfilment). The choice is
 *                               recorded on the order note + audit.
 *   - actor is the authenticated staff member on whose behalf the
 *     order is created: { id, permissions, ip?, userAgent? }. The id
 *     lands on the audit row; ip/userAgent are audit context only.
 *   - The result is a discriminated union: { ok: true, ... } with the
 *     persisted (enriched, UNMASKED) order — callers apply their own
 *     phone masking (phoneForViewer) before serializing — or
 *     { ok: false, httpStatus, code, message, details? } carrying the
 *     exact error the admin route used to return inline
 *     (VALIDATION_ERROR 400, VARIANT_NOT_FOUND 400,
 *     INSUFFICIENT_STOCK 400, FRAUD_BLOCKED 422,
 *     PREORDER_CAP_REACHED 409, IDEMPOTENCY_CONFLICT 409).
 *     Unexpected errors still THROW, exactly as the route let them
 *     propagate — bulk callers wrap per-group calls in try/catch.
 *
 * BEHAVIOUR (unchanged from the route; see git history for the
 * wave-by-wave notes): variant snapshots from the DB (existence +
 * stock, bundle availability while the product-types flag is ON);
 * item prices are STAFF-ENTERED and any difference from the catalog
 * price is recorded on the order note; shipping comes from the shared
 * engine with live Settings rates (staff-chosen method = explicit
 * zone, absent method defaults to inside_dhaka, a staff override
 * replaces the rate and is noted); a coupon code is evaluated by the
 * SAME evaluateOrderCoupon as public checkout and its CouponUsage row
 * is written inside the create transaction; the real scoreFraud()
 * runs with identical enforcement (block -> 422 FRAUD_BLOCKED); the
 * persisted advance requirement is the MAX of the staff-set amount /
 * a prepaid method's full total / the fraud band (wave 21 engine);
 * reseller attribution resolves ACTIVE resellers only and never fails
 * the create; persistence is createOrderRecord's one transaction.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import {
  ServiceBookingCapacityError,
  createOrderRecord,
  findOrderByIdempotencyKey,
  getVariantSnapshots,
  listOrdersByPhone,
  orderRowToEnriched,
} from "@/orders/repository";
import type { Order } from "@/orders/types";
import {
  BundleStockError,
  PreorderCapError,
  productTypesEnabledInDb,
} from "@/catalog/product-types";
import { manualOrderSchema } from "@/orders/manual-order";
import {
  ADVANCE_REASON_LABELS,
  issueAdvancePaymentLink,
  percentAdvancePoisha,
  pickAdvanceRequirement,
  type AdvanceCandidate,
} from "@/orders/advance";
import { loadOrderRules } from "@/checkout/order-rules";
import { findDeliverySlot, loadDeliverySlots } from "@/checkout/delivery-slots";
import { calculateShipping, loadShippingRates } from "@/checkout/shipping";
import { normalizeBdPhone } from "@/checkout/validation";
import { computePricing } from "@/checkout/pricing";
import {
  assembleFraudInput,
  evaluateOrderCoupon,
  fraudEnforcement,
  recordCouponUse,
} from "@/checkout/order-enrichment";
import { scoreFraud } from "@/fraud/scoring";
import { publishOrderCreated } from "@/orders/event-bus";
import { resolveResellerAttribution } from "@/reseller/store";
import { validateOrderLineQuantities } from "@/orders/quantity-rules";
import { lineTotalPoisha } from "@/lib/quantity";
import { restaurantSelectionSchema } from "@/restaurant/selection";
import { prepareKitchenTicket } from "@/restaurant/tickets";
import { serviceBookingSelectionSchema } from "@/services/selection";
import { prepareServiceBooking } from "@/services/bookings";

export const manualCreateInputSchema = manualOrderSchema.extend({
  /** Client idempotency key (UUID). Absent -> the server mints one;
   *  the UNIQUE Order.idempotencyKey column is the backstop, exactly
   *  as in the public create path. */
  idempotencyKey: z.string().uuid().optional(),
  /** Reseller ?ref= code (wave 6): resolves exactly like public
   *  checkout (ACTIVE resellers only); unknown/ineligible codes
   *  never fail the create. */
  resellerCode: z.string().max(32).optional(),
  /** Staff-set advance requirement (poisha, wave 21). Validated
   *  against the computed grand total (0..total); the persisted
   *  requirement is the MAX of this, the fraud band, and a prepaid
   *  method's full total. */
  advanceRequiredPoisha: z.number().int().min(0).optional(),
  /** Advance payment-link policy (doc 18 batch F3, ADDITIVE).
   *  Default "issue": a payment link is created for the persisted
   *  advance requirement, exactly as before. "suppress": NO link is
   *  created — for flows that credit the advance themselves in the
   *  same breath (preorder fulfilment credits the already-paid
   *  deposit immediately after create; a live link in between would
   *  let the customer pay that deposit a second time). Suppression
   *  is recorded on the order note + audit, never silent. */
  advanceLinkPolicy: z.enum(["issue", "suppress"]).optional(),
  /** Subscription "Subscribe & save" discount (ADV-18 remainder,
   *  ADDITIVE): basis points of the item subtotal, read by the caller
   *  from Settings subscriptions.discount_bps. The discount amount is
   *  computed HERE (server-side, integer math) and folded into the
   *  order's discount stage alongside any coupon, with its own note
   *  line — callers never pass a pre-computed amount, so a stale or
   *  tampered figure cannot reach the persisted pricing. */
  subscriptionDiscountBps: z.number().int().min(0).max(10000).optional(),
  /** Restaurant selection (ADV-23, wave 56, ADDITIVE): the same
   *  shape public checkout accepts (src/restaurant/selection). When
   *  present it runs through the identical gate as checkout —
   *  module.restaurant OFF -> 403 FEATURE_LOCKED; ON -> validated
   *  against the effective restaurant.config, and the KitchenTicket
   *  is written inside the create transaction. This is what lets
   *  POS / phone orders reach the KDS board too. */
  restaurant: restaurantSelectionSchema.optional(),
  /** Service booking selection (ADV-23 vertical 2, wave 56,
   *  ADDITIVE): the same shape public checkout accepts
   *  (src/services/selection). When present it runs through the
   *  identical gate as checkout — module.services OFF -> 403
   *  FEATURE_LOCKED; ON -> validated against services.config + the
   *  order's items, capacity counted inside the create transaction,
   *  and the ServiceBooking is written in that transaction. This is
   *  what lets phone/POS bookings land on the bookings board too. */
  booking: serviceBookingSelectionSchema.optional(),
  /** Order.source label for this channel. Default "manual". */
  source: z.string().min(1).max(32).optional(),
  /** Extra note line prepended to the order note — e.g. the inbox
   *  conversion records the conversation id here so the order's
   *  history always names its origin. */
  internalNote: z.string().max(500).optional(),
});

export type ManualCreateInput = z.infer<typeof manualCreateInputSchema>;

export interface ManualOrderActor {
  /** Staff user id, or null for system actors (e.g. the subscription
   *  generator running in the worker): writeAudit records a null
   *  actorId for those, and the order's source label + internal note
   *  carry the channel's identity instead. */
  id: string | null;
  permissions: readonly string[];
  ip?: string;
  userAgent?: string;
}

export interface ManualCreatePricing {
  subtotalPoisha: number;
  discountPoisha: number;
  shippingPoisha: number;
  codFeePoisha: number;
  taxPoisha: number;
  totalPoisha: number;
}

export type ManualCreateResult =
  | {
      ok: true;
      /** True when the idempotency key already existed — the stored
       *  order is returned, nothing was created. On a replay only
       *  `order` is meaningful; pricing/shipping/coupon are null. */
      replayed: boolean;
      /** Enriched order exactly as persisted (UNMASKED phone —
       *  callers mask for their audience). Null only in the
       *  practically-unreachable case where the post-create reload
       *  missed the committed row — orderId/orderNo/pricing below
       *  still carry the created truth (the admin route historically
       *  serialised `order: null` in that same case). On a replay the
       *  stored order is always present. */
      order: Order | null;
      orderId: string;
      orderNo: string;
      /** The effective Order.source the order was stored with. */
      source: string;
      pricing: ManualCreatePricing | null;
      shippingMethod: "inside_dhaka" | "outside_dhaka" | "pickup" | null;
      shippingDefaulted: boolean;
      coupon: {
        applied: boolean;
        status: string;
        code: string | null;
        reasonBn: string | null;
        reasonEn: string | null;
      } | null;
      resellerAttributed: boolean;
      /** Persisted advance block (wave 21): present only when a
       *  requirement was persisted; linkUrl/linkToken ride exactly
       *  once, when link issuance succeeded. */
      advance: {
        requiredPoisha: number;
        reason: string | null;
        linkUrl?: string;
        linkToken?: string;
      } | null;
      riskScore: number | null;
    }
  | {
      ok: false;
      httpStatus: number;
      code: string;
      message: string;
      details?: unknown;
    };

function fail(httpStatus: number, code: string, message: string, details?: unknown): ManualCreateResult {
  return { ok: false, httpStatus, code, message, details };
}

export async function createManualOrder(
  input: ManualCreateInput,
  actor: ManualOrderActor,
): Promise<ManualCreateResult> {
  const parsed = manualCreateInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Manual order input invalid.",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const data = parsed.data;
  const source = data.source ?? "manual";
  // manualOrderSchema validated the pattern; normalize to the stored
  // +8801XXXXXXXXX form exactly like the checkout schema transform.
  const phone = normalizeBdPhone(data.phone);
  if (!phone) {
    return fail(400, "VALIDATION_ERROR", "Manual order input invalid.", ["phone: invalid BD phone"]);
  }
  // Wave 59: fractional quantities only on grocery weighted variants
  // (weight-step gated) — the same rule public checkout enforces.
  // Every createManualOrder consumer (drafts, inbox, import, B2B,
  // subscriptions, abandoned conversion) inherits the gate here.
  const qtyGate = await validateOrderLineQuantities(data.items);
  if (!qtyGate.ok) {
    return fail(400, qtyGate.code, qtyGate.message, qtyGate.details);
  }
  // Restaurant selection (ADV-23, wave 56): the identical gate the
  // public checkout runs (shared helper — flag 403, config 400), so
  // every createManualOrder consumer (POS, drafts, inbox, import,
  // B2B conversion) inherits the same restaurant behaviour. Runs
  // before the idempotency replay check, like the quantity gate: a
  // locked/invalid restaurant payload is refused, never replayed
  // into a ticket.
  const kitchenPrep = await prepareKitchenTicket(data.restaurant);
  if (!kitchenPrep.ok) {
    return fail(kitchenPrep.httpStatus, kitchenPrep.code, kitchenPrep.message);
  }
  // Service booking (ADV-23 vertical 2, wave 56): the identical
  // gate the public checkout runs (shared helper — flag 403,
  // config/items 400), so every createManualOrder consumer inherits
  // the same booking behaviour. Runs before the idempotency replay
  // check, like the gates above.
  const bookingPrep = await prepareServiceBooking(data.booking, data.items);
  if (!bookingPrep.ok) {
    return fail(bookingPrep.httpStatus, bookingPrep.code, bookingPrep.message);
  }
  const idempotencyKey = data.idempotencyKey ?? randomUUID();

  // Idempotency first: a replay returns the stored order, never a copy.
  const existingRow = await findOrderByIdempotencyKey(idempotencyKey);
  if (existingRow) {
    const order = orderRowToEnriched(existingRow);
    return {
      ok: true,
      replayed: true,
      order,
      orderId: order.id,
      orderNo: order.orderNo,
      source: order.source ?? source,
      pricing: null,
      shippingMethod: null,
      shippingDefaulted: false,
      coupon: null,
      resellerAttributed: false,
      advance: null,
      riskScore: null,
    };
  }

  // DB snapshots: existence, stock, product name + SKU. Only the unit
  // price is staff-entered (see header note).
  const snapshots = await getVariantSnapshots(data.items.map((i) => i.variantId));
  // Wave 15: bundle availability is component-derived while the
  // product-types flag is ON (same rule as public checkout).
  const typesOn = await productTypesEnabledInDb();
  const items: Order["items"] = [];
  const priceOverrides: string[] = [];
  let subtotalPoisha = 0;
  for (const item of data.items) {
    const server = snapshots.get(item.variantId);
    if (!server) {
      return fail(400, "VARIANT_NOT_FOUND", `Variant not found: ${item.variantId}`);
    }
    const availableStock =
      typesOn && server.productType === "BUNDLE" && server.bundleAvailability !== null
        ? server.bundleAvailability
        : server.stock;
    if (availableStock < item.quantity) {
      return fail(400, "INSUFFICIENT_STOCK", `Insufficient stock for ${server.sku}.`, {
        variantId: item.variantId,
        sku: server.sku,
        availableStock,
        requested: item.quantity,
      });
    }
    items.push({
      variantId: server.variantId,
      productName: server.productName,
      sku: server.sku,
      unitPricePoisha: item.unitPricePoisha,
      quantity: item.quantity,
    });
    subtotalPoisha += lineTotalPoisha(item.unitPricePoisha, item.quantity);
    if (item.unitPricePoisha !== server.unitPricePoisha) {
      priceOverrides.push(
        `${server.sku}: কর্মীর দাম ${item.unitPricePoisha} পয়সা (ক্যাটালগ ${server.unitPricePoisha} পয়সা)`,
      );
    }
  }

  const priorOrders = await listOrdersByPhone(phone);

  // Shipping (v2): the public-checkout rate for the chosen method, or
  // the staff override when one was set. An absent method defaults to
  // inside_dhaka — the common phone-order case — and the result says so.
  const shippingMethod = data.shippingMethod ?? "inside_dhaka";
  // Settings-backed rates via the shared shipping engine (wave 20): the
  // staff-picked method IS the zone for phone orders (explicit zone input),
  // weight is unknown here (0) — the staff override covers special cases.
  const shippingRates = await loadShippingRates();
  const rateShippingPoisha = calculateShipping(shippingRates, {
    zone: shippingMethod,
    shippingMethod,
    totalWeightGrams: 0,
    subtotalPoisha,
  }).shippingPoisha;
  const baseShippingPoisha = data.shippingOverridePoisha ?? rateShippingPoisha;

  // Coupon (v2): the SAME evaluator public checkout uses. It sees the
  // base shipping above, so a free-shipping coupon zeroes even a staff
  // override — identical semantics to the storefront. An ineligible or
  // unknown code never fails the order: discount 0, outcome in result.
  const coupon = evaluateOrderCoupon({
    code: data.couponCode,
    subtotalPoisha,
    shippingPoisha: baseShippingPoisha,
    userKey: phone,
    isFirstOrder: priorOrders.length === 0,
  });

  // Subscription discount (ADV-18 remainder): computed from the bps
  // the caller read from Settings, integer math, folded into the same
  // discount stage as the coupon so the persisted discountPoisha and
  // grand total stay consistent (computePricing clamps the taxable
  // base at zero).
  const subscriptionDiscountPoisha =
    data.subscriptionDiscountBps !== undefined && data.subscriptionDiscountBps > 0
      ? Math.floor((subtotalPoisha * data.subscriptionDiscountBps) / 10000)
      : 0;

  const pricing = computePricing({
    itemsSubtotalPoisha: subtotalPoisha,
    couponDiscountPoisha: coupon.discountPoisha + subscriptionDiscountPoisha,
    shippingPoisha: coupon.shippingPoisha,
    codFeePoisha: 0,
    taxBps: 0,
  });

  // Same fraud scoring + enforcement as public checkout. Signal details
  // never leave the server; staff see them in the admin fraud UI.
  const now = new Date().toISOString();
  const assessment = scoreFraud(
    await assembleFraudInput({
      phone,
      address: data.address,
      paymentMethod: data.paymentMethod,
      totalPoisha: pricing.grandTotalPoisha,
      itemKeys: items.map((i) => i.variantId),
      priorOrders,
      now,
    }),
  );
  const enforcement = fraudEnforcement(assessment);
  if (enforcement.blocked) {
    return fail(
      422,
      "FRAUD_BLOCKED",
      "দুঃখিত, এই অর্ডারটি গ্রহণ করা যাচ্ছে না। সহায়তার জন্য আমাদের সাথে যোগাযোগ করুন। / Sorry, this order cannot be accepted. Please contact support for help.",
    );
  }

  // Advance requirement (wave 21, doc 17 batch O3): the staff-set
  // amount is validated against the computed grand total, then the
  // PERSISTED requirement is the MAX of staff-set / prepaid full
  // total / the fraud band (priced with the configured percent) —
  // the same engine public checkout runs. The rules-threshold
  // candidate is checkout-only policy and is not applied here.
  if (
    data.advanceRequiredPoisha !== undefined &&
    data.advanceRequiredPoisha > pricing.grandTotalPoisha
  ) {
    return fail(
      400,
      "VALIDATION_ERROR",
      `অগ্রিমের পরিমাণ অর্ডারের মোট মূল্যের (${pricing.grandTotalPoisha} পয়সা) বেশি হতে পারবে না। / The advance amount cannot exceed the order total (${pricing.grandTotalPoisha} poisha).`,
      ["advanceRequiredPoisha: exceeds the order total"],
    );
  }
  const advanceCandidates: AdvanceCandidate[] = [];
  if (data.advanceRequiredPoisha !== undefined && data.advanceRequiredPoisha > 0) {
    advanceCandidates.push({
      amountPoisha: data.advanceRequiredPoisha,
      reason: ADVANCE_REASON_LABELS.staff,
    });
  }
  if (data.paymentMethod !== "cod") {
    advanceCandidates.push({
      amountPoisha: pricing.grandTotalPoisha,
      reason: ADVANCE_REASON_LABELS.prepaid,
    });
  }
  if (enforcement.advanceRequired) {
    const rules = await loadOrderRules();
    advanceCandidates.push({
      amountPoisha: percentAdvancePoisha(pricing.grandTotalPoisha, rules.advancePercent),
      reason: ADVANCE_REASON_LABELS.fraud_review,
    });
  }
  const advanceRequirement = pickAdvanceRequirement(advanceCandidates);

  // Reseller attribution (wave 6): the optional code staff entered
  // resolves exactly like public checkout — ACTIVE resellers only,
  // never failing the create (see resolveResellerAttribution).
  const attribution = await resolveResellerAttribution(data.resellerCode);

  // Delivery slot (wave 27, doc 17 batch O9-2, ADDITIVE): resolved
  // against the configured set exactly like public checkout — only a
  // match persists. This is also what makes draft conversion safe: a
  // slot id stored in a draft payload is re-validated here at
  // conversion time, never trusted from storage.
  const deliverySlot = findDeliverySlot(await loadDeliverySlots(), data.deliverySlotId);

  // Staff note + price-override record share the order's note row, so
  // the negotiated pricing is visible in the order history. The
  // channel internalNote (e.g. inbox conversation id) goes first.
  const noteParts = [
    data.internalNote?.trim() ? data.internalNote.trim() : null,
    data.note?.trim() ? data.note.trim() : null,
    priceOverrides.length > 0
      ? `ম্যানুয়াল অর্ডার — কর্মীর নির্ধারিত দাম: ${priceOverrides.join("; ")}`
      : null,
    subscriptionDiscountPoisha > 0
      ? `সাবস্ক্রিপশন ছাড় (Subscribe & Save, ${(data.subscriptionDiscountBps ?? 0) / 100}%): ${subscriptionDiscountPoisha} পয়সা / Subscription discount: ${subscriptionDiscountPoisha} poisha`
      : null,
    data.shippingOverridePoisha !== undefined &&
    data.shippingOverridePoisha !== rateShippingPoisha
      ? `ম্যানুয়াল অর্ডার — ডেলিভারি চার্জ কর্মীর নির্ধারিত ${data.shippingOverridePoisha} পয়সা (${shippingMethod} অনুযায়ী ${rateShippingPoisha} পয়সা)`
      : null,
    // Doc 18 F3: a suppressed advance link is stated on the order's
    // own timeline, so staff never wonder where the link went.
    data.advanceLinkPolicy === "suppress" && advanceRequirement.advanceRequiredPoisha > 0
      ? `অগ্রিম লিংক ইস্যু করা হয়নি — জমা সরাসরি ক্রেডিট হিসেবে জমা হয়েছে। / Advance payment link not issued — the advance is credited directly.`
      : null,
  ].filter((p): p is string => p !== null);

  // data.customerId (from the builder's phone lookup) is deliberately
  // NOT passed on: createOrderRecord resolves the customer by phone
  // (find-or-create), the same contract as public checkout.
  let created: Awaited<ReturnType<typeof createOrderRecord>>;
  try {
    created = await createOrderRecord({
      idempotencyKey,
      customerName: data.customerName,
      customerPhone: phone,
      address: data.address,
      items,
      pricing: {
        subtotalPoisha: pricing.subtotalPoisha,
        discountPoisha: pricing.couponDiscountPoisha,
        shippingPoisha: pricing.shippingPoisha,
        codFeePoisha: pricing.codFeePoisha,
        taxPoisha: pricing.taxPoisha,
        totalPoisha: pricing.grandTotalPoisha,
      },
      paymentMethod: data.paymentMethod,
      riskScore: assessment.score,
      // Wave 21: persisted advance requirement + OTP flag, same
      // contract as public checkout.
      advanceRequiredPoisha: advanceRequirement.advanceRequiredPoisha,
      advanceReason: advanceRequirement.advanceReason ?? undefined,
      requiresOtp: enforcement.requiresOtp,
      appliedCoupon:
        coupon.status === "applied" && coupon.code
          ? { code: coupon.code, discountPoisha: coupon.discountPoisha }
          : null,
      note: noteParts.length > 0 ? noteParts.join("\n") : undefined,
      source,
      resellerId: attribution?.id,
      // Wave 27 (doc 17 O9-2, ADDITIVE): slot + gift pass through to
      // the same Order columns public checkout writes. The slot id
      // was resolved against the configured set above (deliverySlot);
      // an unmatched id arrives here as undefined and persists
      // nothing.
      deliverySlot: deliverySlot?.id,
      giftMessage: data.giftMessage !== undefined ? data.giftMessage.trim() : undefined,
      // ADV-23 (wave 56): the validated kitchen-ticket spec (null for
      // every non-restaurant order) — written in the create
      // transaction, exactly like public checkout.
      kitchenTicket: kitchenPrep.ticket,
      // ADV-23 vertical 2 (wave 56): the validated booking write
      // spec (null for every non-booking order) — written in the
      // create transaction, capacity enforced there.
      serviceBooking: bookingPrep.booking,
    });
  } catch (e) {
    // Wave 15 product-type failures roll the create back — map them
    // to honest client errors like the public route does, not a 500.
    if (e instanceof BundleStockError) {
      return fail(400, "INSUFFICIENT_STOCK", e.message, e.details);
    }
    // ADV-23 services (wave 56): the slot filled between validation
    // and the create — the transaction rolled back in full.
    if (e instanceof ServiceBookingCapacityError) {
      return fail(409, e.code, e.message);
    }
    if (e instanceof PreorderCapError) {
      return fail(409, "PREORDER_CAP_REACHED", e.message, e.details);
    }
    throw e;
  }
  if (created.replayed) {
    const row = await findOrderByIdempotencyKey(idempotencyKey);
    if (row) {
      const order = orderRowToEnriched(row);
      return {
        ok: true,
        replayed: true,
        order,
        orderId: order.id,
        orderNo: order.orderNo,
        source: order.source ?? source,
        pricing: null,
        shippingMethod: null,
        shippingDefaulted: false,
        coupon: null,
        resellerAttributed: false,
        advance: null,
        riskScore: null,
      };
    }
    return fail(409, "IDEMPOTENCY_CONFLICT", "This manual order was already processed.");
  }

  // Reload the stored row so the result is exactly what persisted
  // (and publish order.created from that same stored truth).
  const storedRow = await findOrderByIdempotencyKey(idempotencyKey);
  const stored = storedRow ? orderRowToEnriched(storedRow) : null;
  if (stored) publishOrderCreated(stored);
  // Advance collection (wave 21): issue the payment link for exactly
  // the persisted requirement (fresh creates only — replays returned
  // above). A failure leaves the result with amount + reason only.
  // Doc 18 F3: advanceLinkPolicy "suppress" skips issuance entirely —
  // the caller credits the advance itself right after create
  // (preorder fulfilment), so no live link ever exists that could be
  // paid twice. Noted on the order (noteParts above) + audit below.
  const advanceLinkSuppressed =
    data.advanceLinkPolicy === "suppress" && advanceRequirement.advanceRequiredPoisha > 0;
  const advanceLink =
    advanceRequirement.advanceRequiredPoisha > 0 && !advanceLinkSuppressed
      ? await issueAdvancePaymentLink(created.orderId, advanceRequirement.advanceRequiredPoisha)
      : null;
  // Coupon usage bookkeeping — only now that the order exists, never
  // on a fraud block (returned above) or a replay (returned earlier);
  // the durable CouponUsage row was written in the create transaction.
  if (coupon.status === "applied" && coupon.record) {
    recordCouponUse(coupon.record, phone);
  }
  await writeAudit({
    actorId: actor.id,
    action: "orders.create",
    entityType: "Order",
    entityId: created.orderId,
    afterJson: {
      orderNo: created.orderNo,
      source,
      totalPoisha: pricing.grandTotalPoisha,
      paymentMethod: data.paymentMethod,
      itemCount: items.length,
      riskScore: assessment.score,
      resellerId: attribution?.id ?? null,
      shippingMethod,
      shippingPoisha: pricing.shippingPoisha,
      shippingOverridden: data.shippingOverridePoisha !== undefined,
      couponCode: coupon.code,
      couponStatus: coupon.status,
      subscriptionDiscountBps: data.subscriptionDiscountBps ?? null,
      subscriptionDiscountPoisha,
      customerId: data.customerId ?? null,
      advanceRequiredPoisha: advanceRequirement.advanceRequiredPoisha,
      advanceReason: advanceRequirement.advanceReason,
      advanceLinkIssued: advanceLink !== null,
      advanceLinkSuppressed,
    },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  // `stored` is null only if the post-create reload missed the
  // committed row (a delete race) — orderId/orderNo/pricing still
  // carry the created truth in that case.
  return {
    ok: true,
    replayed: false,
    order: stored,
    orderId: created.orderId,
    orderNo: created.orderNo,
    source,
    pricing: {
      subtotalPoisha: pricing.subtotalPoisha,
      discountPoisha: pricing.couponDiscountPoisha,
      shippingPoisha: pricing.shippingPoisha,
      codFeePoisha: pricing.codFeePoisha,
      taxPoisha: pricing.taxPoisha,
      totalPoisha: pricing.grandTotalPoisha,
    },
    shippingMethod,
    shippingDefaulted: data.shippingMethod === undefined,
    coupon: {
      applied: coupon.status === "applied",
      status: coupon.status,
      code: coupon.code,
      reasonBn: coupon.reasonBn,
      reasonEn: coupon.reasonEn,
    },
    resellerAttributed: attribution !== null,
    advance:
      advanceRequirement.advanceRequiredPoisha > 0
        ? {
            requiredPoisha: advanceRequirement.advanceRequiredPoisha,
            reason: advanceRequirement.advanceReason,
            ...(advanceLink ? { linkUrl: advanceLink.url, linkToken: advanceLink.plainToken } : {}),
          }
        : null,
    riskScore: assessment.score,
  };
}
