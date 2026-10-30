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
 * - Restaurant (ADV-23, wave 56): an optional `restaurant` selection
 *   (dine-in + table, or takeaway) is gated by module.restaurant —
 *   field present + flag OFF -> 403 FEATURE_LOCKED; flag ON -> the
 *   choice is validated against the effective Setting doc
 *   restaurant.config (src/restaurant/tickets.prepareKitchenTicket)
 *   and the KitchenTicket row is written inside the create
 *   transaction. No money is affected: no service charge exists.
 * - Rental (ADV-23 vertical 3, wave 56): an optional `rental`
 *   selection (variant + start/end dates) is gated by
 *   module.rental — field present + flag OFF -> 403
 *   FEATURE_LOCKED; flag ON -> the range is validated against the
 *   effective Setting doc rental.config
 *   (src/rental/bookings.prepareRentalBooking, run after the price
 *   snapshots because a percent deposit derives from the SERVER
 *   price) and the RentalBooking row is written inside the create
 *   transaction, which also counts overlapping live rentals
 *   against the variant's stock. The ONE money touch: when
 *   rental.config sets a deposit, it enters the pricing pipeline
 *   as the rentalDepositPoisha line (src/checkout/pricing) —
 *   its own visible breakdown line, included in the grand total,
 *   frozen on the RentalBooking row; the refund on return is a
 *   manual admin action in v1.
 * - Dynamic checkout fields (doc 28): the merchant-editable field
 *   config (Setting doc checkout.fields, src/checkout/fields.ts) is
 *   enforced HERE — this public route is the storefront create path
 *   only; staff manual orders go through createManualOrder and keep
 *   the standard schema. A hidden email/union/note is treated as
 *   absent, a visible+required one refuses the create (400
 *   CHECKOUT_FIELD_REQUIRED), and the merchant's extra fields ride
 *   the body as `fieldAnswers` (required enforced, trimmed, <= 200
 *   chars — 400 CHECKOUT_FIELD_TOO_LONG; unknown keys dropped).
 *   Answers persist on the create-time OrderNote (one human line per
 *   answer + the `[checkout-fields] {json}` machine line). With the
 *   default config nothing changes: the toggleable fields are
 *   visible + optional and there are no extras.
 *   Doc 29 extends the same gate with conditions + validation:
 *   visibility / requirement are evaluated EFFECTIVELY against the
 *   live context (payment method, shipping method, division, and
 *   the merchandise subtotal recomputed from DB variant prices with
 *   the platform line-total rule), and present values are checked
 *   against the field's validation rules (400
 *   CHECKOUT_FIELD_TOO_SHORT / _TOO_LONG / _INVALID_FORMAT).
 *   Address mode (`addressMode` on the same doc): in "single" mode
 *   the checkout collects ONE free-text address, so the body is
 *   parsed with a relaxed-cascade variant of the same schema
 *   (division/district/upazila optional, default ""), enforcement
 *   runs against effectiveFields(config) (cascade + union forced
 *   hidden = treated as absent), and the order stores "" cascade
 *   columns — the shipping engine prices the empty district via
 *   its outside-Dhaka fallback. Cascade mode is byte-identical.
 * - Print-on-demand (ADV-23 vertical 5, wave 56): an optional
 *   `pod` customisation (variant + print text + optional palette
 *   colour) is gated by module.print_on_demand — field present +
 *   flag OFF -> 403 FEATURE_LOCKED; flag ON -> validated against
 *   the effective Setting doc pod.config
 *   (src/pod/customisation.preparePodCustomisation: variant on
 *   the printable list, text sanitised + within the config cap,
 *   colour on the palette) and frozen onto the order's create-time
 *   note (human line + `[pod:{...}]` machine line — no POD table
 *   exists). The ONE money touch mirrors the rental deposit: the
 *   config's per-item print fee × the line quantity enters the
 *   pricing pipeline as the printFeePoisha line — its own visible
 *   breakdown line, included in the grand total. No image upload
 *   exists in v1 (storage-gated).
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
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { cookies } from "next/headers";
import { z } from "zod";
import { bdAddressSchema, checkoutFormSchema } from "@/checkout/validation";
import {
  effectiveFields,
  effectiveRequired,
  effectiveVisible,
  fieldByKey,
  MAX_ANSWER_LENGTH,
  validateAnswer,
  type CheckoutConditionContext,
  type CheckoutFieldDef,
  type CheckoutFieldsConfig,
} from "@/checkout/fields";
import { getCheckoutFieldsConfig } from "@/checkout/fields-server";
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
  RentalCapacityError,
  ServiceBookingCapacityError,
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
import { prepareKitchenTicket } from "@/restaurant/tickets";
import { prepareServiceBooking } from "@/services/bookings";
import { prepareRentalBooking, rentalOrderNoteText } from "@/rental/bookings";
import { preparePodCustomisation } from "@/pod/customisation";
import { podOrderNoteText } from "@/pod/selection";
import { validateOrderLineQuantities } from "@/orders/quantity-rules";
import { funnelStore } from "@/funnels/store";
import {
  verifyBumpClaim,
  verifyFunnelContextClaim,
  type BumpClaimPayload,
} from "@/funnels/claims";
import { createFunnelToken } from "@/funnels/token";
import { offerDiscountPoisha, resolveStepOffer } from "@/funnels/offer";
import {
  funnelAttributionNoteText,
  funnelOfferNoteText,
  nextStepAfter,
  offerDiscountsEqual,
  type FunnelOfferLineRecord,
} from "@/funnels/runtime";
import { landingCatalogQueriesPublic } from "@/landing/catalog";
import type { BumpOffer, Funnel } from "@/funnels/types";
import { lineTotalPoisha, qtyToMilli, roundHalfUpDiv, QTY_MILLI } from "@/lib/quantity";

function errorResponse(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

// Doc 28: the create body additionally carries the merchant-defined
// extra fields' answers. The extension is additive and lives here
// (not in src/checkout/validation.ts) because the answers are a
// storefront-only surface — the shared checkoutFormSchema also backs
// the staff manual-create seam, which never sees fieldAnswers.
// Unknown keys inside fieldAnswers are NOT a schema error: the
// enforcement below reads only config-defined keys and drops the
// rest.
const storefrontBodyExtensions = {
  fieldAnswers: z.record(z.string(), z.string()).optional(),
  // Doc 34 L7 (§3.7): funnel claims from a funnel order step's
  // QuickOrderForm — additive like fieldAnswers, funnel-only.
  // `funnel` is the signed context claim (attribution +
  // continuation); `bump` is the §3.7 signed bump claim, present
  // only when the customer ticked the bump card. Both are CLAIMS,
  // never prices: resolveFunnelOrderContext below re-loads the
  // funnel, re-checks the rule and resolves live prices, and every
  // failure path drops the funnel piece — NEVER the order.
  funnel: z.object({ token: z.string().min(1) }).optional(),
  bump: z.object({ token: z.string().min(1) }).optional(),
};
const createOrderBodySchema = checkoutFormSchema.extend(storefrontBodyExtensions);

// Address mode (checkout.fields `addressMode: "single"`): the
// checkout collects ONE free-text address, so division / district
// / upazila arrive missing or "" — this variant makes them
// optional with a "" default (the Order / Address columns are
// plain strings, so "" stores as-is; the shipping engine prices
// an empty district with its outside-Dhaka fallback). Built from
// the SAME base schema + the SAME storefront extensions, so every
// other field keeps the strict parse, addressLine stays required
// (min length included), and the schema above remains the
// cascade-mode parse, byte-identical. src/checkout/validation.ts
// is NOT relaxed: its shared schema also backs staff manual
// orders, which always collect the cascade.
const createOrderBodySingleSchema = checkoutFormSchema.extend({
  address: bdAddressSchema.extend({
    division: z.string().trim().optional().default(""),
    district: z.string().trim().optional().default(""),
    upazila: z.string().trim().optional().default(""),
  }),
  ...storefrontBodyExtensions,
});
type CreateOrderBody = z.infer<typeof createOrderBodySchema>;

/** The funnel context a create resolved to (doc 34 §3.7/§3.8). */
interface ResolvedFunnelOrderContext {
  funnel: Funnel;
  stepId: string;
  /** The order step's CURRENT stored bump (rule source of truth). */
  bumpOffer: BumpOffer | null;
  /** The catalog variant the bump line will use, when the bump
   *  claim verified end-to-end; null = no bump line. */
  bumpVariantId: string | null;
}

/**
 * Doc 34 L7: verify the funnel claims on a create and resolve the
 * bump variant — DROP-NOT-FAIL on every path (a broken bump must
 * never lose a sale, §3.7). Returns null when no claim verifies to
 * a PUBLISHED funnel's order step; the create then proceeds as a
 * plain order. Every drop is logged server-side.
 *
 * Verification order: the bump claim and the context claim are
 * verified independently; when both are present they must AGREE on
 * (funnelId, stepId) or the whole context is dropped. The funnel
 * is re-loaded from the DB and must be PUBLISHED; the step must be
 * its order step. For the bump: the claim's discount rule must
 * deep-equal the step's CURRENT stored rule; the product comes
 * from the stored bump (never the claim); the variant is the
 * stored pinned variant (claim must match it) or the claim's
 * variant when it still resolves active in the live catalog, else
 * the live pick. Price is NOT resolved here — the caller prices
 * the line from the repository snapshot like every other line.
 */
async function resolveFunnelOrderContext(
  form: CreateOrderBody,
): Promise<ResolvedFunnelOrderContext | null> {
  if (!form.funnel?.token && !form.bump?.token) return null;
  try {
    let funnelId: string | null = null;
    let stepId: string | null = null;
    let bumpClaim: BumpClaimPayload | null = null;
    if (form.bump?.token) {
      bumpClaim = verifyBumpClaim(form.bump.token);
      if (bumpClaim) {
        funnelId = bumpClaim.funnelId;
        stepId = bumpClaim.stepId;
      } else {
        console.error("[funnels] bump claim failed verification — bump dropped, order continues");
      }
    }
    if (form.funnel?.token) {
      const ctxClaim = verifyFunnelContextClaim(form.funnel.token);
      if (ctxClaim) {
        if (funnelId !== null && (ctxClaim.funnelId !== funnelId || ctxClaim.stepId !== stepId)) {
          console.error("[funnels] funnel context and bump claims disagree — funnel context dropped, order continues");
          return null;
        }
        funnelId = ctxClaim.funnelId;
        stepId = ctxClaim.stepId;
      } else {
        console.error("[funnels] funnel context claim failed verification — attribution/continuation dropped, order continues");
      }
    }
    if (!funnelId || !stepId) return null;
    const funnel = await funnelStore.get(funnelId);
    if (!funnel || funnel.status !== "PUBLISHED") {
      console.error("[funnels] claimed funnel is not published — funnel context dropped, order continues");
      return null;
    }
    const step = funnel.steps.find((s) => s.id === stepId);
    if (!step || step.kind !== "order") {
      console.error("[funnels] claimed step is not the funnel's order step — funnel context dropped, order continues");
      return null;
    }
    let bumpVariantId: string | null = null;
    if (bumpClaim) {
      if (!step.bump) {
        console.error("[funnels] bump claim for a step without a bump — bump dropped, order continues");
      } else if (!offerDiscountsEqual(bumpClaim.discount, step.bump.discount)) {
        console.error("[funnels] bump claim rule no longer matches the step's stored rule — bump dropped, order continues");
      } else {
        const bump = step.bump;
        const products = await landingCatalogQueriesPublic.byIds([bump.productId]);
        const product = products.find((p) => p.id === bump.productId);
        if (!product) {
          console.error("[funnels] bump product no longer resolves in the live catalog — bump dropped, order continues");
        } else if (bump.variantId) {
          if (
            bumpClaim.variantId === bump.variantId &&
            product.variants.some((v) => v.id === bump.variantId && v.isActive)
          ) {
            bumpVariantId = bump.variantId;
          } else {
            console.error("[funnels] bump claim variant does not match the pinned variant — bump dropped, order continues");
          }
        } else if (
          bumpClaim.variantId &&
          product.variants.some((v) => v.id === bumpClaim.variantId && v.isActive)
        ) {
          bumpVariantId = bumpClaim.variantId;
        } else {
          bumpVariantId = resolveStepOffer(bump, products)?.variantId ?? null;
          if (!bumpVariantId) {
            console.error("[funnels] bump variant no longer resolves — bump dropped, order continues");
          }
        }
      }
    }
    return { funnel, stepId: step.id, bumpOffer: step.bump ?? null, bumpVariantId };
  } catch (e) {
    console.error("[funnels] funnel order context resolution failed — order continues without funnel context", e);
    return null;
  }
}

type CheckoutFieldsGate =
  | { ok: true; form: CreateOrderBody; noteText?: string }
  | { ok: false; code: string; message: string; details: { field: string } };

/**
 * Doc 28 + doc 29 enforcement against the saved checkout.fields
 * config. The config is loaded ONCE by POST (which also picks the
 * parse schema from its addressMode) and threaded in, so the gate
 * enforces the exact snapshot the body was parsed with. Doc 29
 * evaluates each field's EFFECTIVE visibility / requirement
 * against the live context (payment method, shipping method,
 * division, merchandise subtotal) and validates present values
 * against the field's rules. Returns the (possibly adjusted) form
 * plus the OrderNote text for the extra-field answers, or the
 * refusal to return. With the default config (no conditions or
 * validation anywhere) this is a no-op, exactly as doc 28:
 * email/union/note are visible + optional and there are no extras.
 *
 * Enforcement runs against effectiveFields(config): in single
 * address mode that forces the cascade + union defs hidden, and a
 * not-effectively-visible field is treated as absent below — so a
 * saved "union required" (or a union condition) can never refuse
 * or leak into a single-mode order.
 */
async function enforceCheckoutFields(
  form: CreateOrderBody,
  config: CheckoutFieldsConfig,
): Promise<CheckoutFieldsGate> {
  const effConfig: CheckoutFieldsConfig = { ...config, fields: effectiveFields(config) };

  // Single address mode: the cascade is not collected — whatever a
  // stale client still sent is normalised to "" here (treated as
  // absent, the same discipline as a hidden field's value below),
  // so the order stores "" cascade columns and the condition
  // context sees the same empty division the order will carry.
  const singleMode = config.addressMode === "single";
  const division = singleMode ? "" : form.address.division;
  const district = singleMode ? "" : form.address.district;
  const upazila = singleMode ? "" : form.address.upazila;

  // Doc 29 condition context. The merchandise subtotal is recomputed
  // from DB variant prices ONLY when some field actually carries a
  // cart-total condition — otherwise the gate stays read-free,
  // exactly as doc 28. Unknown variant ids contribute 0 (later gates
  // reject them anyway); a lookup failure leaves the total
  // undefined, which simply never matches a cart-total condition.
  const needsCartTotal = effConfig.fields.some(
    (f) => f.visibleWhen?.source === "cartTotal" || f.requiredWhen?.source === "cartTotal",
  );
  let cartTotalPoisha: number | undefined;
  if (needsCartTotal) {
    try {
      const snapshots = await getVariantSnapshots([...new Set(form.items.map((i) => i.variantId))]);
      cartTotalPoisha = 0;
      for (const item of form.items) {
        const snap = snapshots.get(item.variantId);
        if (snap) cartTotalPoisha += lineTotalPoisha(snap.unitPricePoisha, item.quantity);
      }
    } catch {
      cartTotalPoisha = undefined;
    }
  }
  const ctx: CheckoutConditionContext = {
    paymentMethod: form.paymentMethod,
    shippingMethod: form.shippingMethod,
    division,
    ...(cartTotalPoisha !== undefined ? { cartTotalPoisha } : {}),
  };

  const refuse = (code: string, key: string, message: string): CheckoutFieldsGate => ({
    ok: false,
    code,
    message,
    details: { field: key },
  });
  const refuseRequired = (key: string): CheckoutFieldsGate =>
    refuse(
      "CHECKOUT_FIELD_REQUIRED",
      key,
      `চেকআউটের আবশ্যক ঘরটি পূরণ করুন: ${key} / Please fill in the required checkout field: ${key}.`,
    );
  // Doc 29 validation of a present (non-empty) value; null = valid.
  const refuseInvalid = (def: CheckoutFieldDef, value: string): CheckoutFieldsGate | null => {
    const failure = validateAnswer(def, value);
    if (!failure) return null;
    if (failure === "TOO_SHORT") {
      return refuse(
        "CHECKOUT_FIELD_TOO_SHORT",
        def.key,
        `উত্তরটি কমপক্ষে ${def.validation?.minLength ?? 0} অক্ষরের হতে হবে: ${def.key} / Answer must be at least ${def.validation?.minLength ?? 0} characters: ${def.key}.`,
      );
    }
    if (failure === "TOO_LONG") {
      return refuse(
        "CHECKOUT_FIELD_TOO_LONG",
        def.key,
        `উত্তরটি সর্বোচ্চ ${def.validation?.maxLength ?? MAX_ANSWER_LENGTH} অক্ষরের মধ্যে হতে হবে: ${def.key} / Answer must be at most ${def.validation?.maxLength ?? MAX_ANSWER_LENGTH} characters: ${def.key}.`,
      );
    }
    return refuse(
      "CHECKOUT_FIELD_INVALID_FORMAT",
      def.key,
      `উত্তরটির ধরন সঠিক নয়: ${def.key} / The answer format is not valid: ${def.key}.`,
    );
  };

  // Built-in toggleable fields: a field that is not EFFECTIVELY
  // visible (static flag or a non-matching visibleWhen) has its
  // submitted value treated as absent; an effectively required
  // field must be non-empty; a present value must satisfy the
  // field's validation rules.
  let email = form.email;
  let union = form.address.union;
  let note = form.note;
  const builtins = [
    { key: "email", value: form.email, apply: (v: string | undefined) => { email = v; } },
    { key: "union", value: form.address.union, apply: (v: string | undefined) => { union = v; } },
    { key: "note", value: form.note, apply: (v: string | undefined) => { note = v; } },
  ] as const;
  for (const field of builtins) {
    const def = fieldByKey(effConfig, field.key);
    if (!def) continue;
    if (!effectiveVisible(def, ctx)) {
      field.apply(undefined);
      continue;
    }
    if (effectiveRequired(def, ctx) && (field.value === undefined || field.value.trim() === "")) {
      return refuseRequired(field.key);
    }
    if (field.value !== undefined && field.value.trim() !== "") {
      const refusal = refuseInvalid(def, field.value);
      if (refusal) return refusal;
    }
  }

  // addressLine: visibility + required are locked, but it may carry
  // a validation block — its (always present) value must satisfy it.
  const addressLineDef = fieldByKey(effConfig, "addressLine");
  if (addressLineDef) {
    const refusal = refuseInvalid(addressLineDef, form.address.addressLine);
    if (refusal) return refusal;
  }

  // Extra fields: answers come from fieldAnswers by config key only
  // (unknown keys dropped). Extras that are not effectively visible
  // are ignored entirely.
  const answers: Record<string, string> = {};
  const humanLines: string[] = [];
  for (const def of effConfig.fields) {
    if (!def.extra || !effectiveVisible(def, ctx)) continue;
    const raw = form.fieldAnswers?.[def.key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value.length > MAX_ANSWER_LENGTH) {
      return refuse(
        "CHECKOUT_FIELD_TOO_LONG",
        def.key,
        `উত্তরটি সর্বোচ্চ ${MAX_ANSWER_LENGTH} অক্ষরের মধ্যে হতে হবে: ${def.key} / Answer must be at most ${MAX_ANSWER_LENGTH} characters: ${def.key}.`,
      );
    }
    if (effectiveRequired(def, ctx) && value === "") {
      return refuseRequired(def.key);
    }
    if (value !== "") {
      const refusal = refuseInvalid(def, value);
      if (refusal) return refusal;
      answers[def.key] = value;
      humanLines.push(`${def.labelBn || def.labelEn}: ${value}`);
    }
  }
  const noteText =
    humanLines.length > 0
      ? [...humanLines, `[checkout-fields] ${JSON.stringify(answers)}`].join("\n")
      : undefined;

  // Rebuild the form ONLY when a hidden field actually carried a
  // value (or single mode normalised the cascade) — with the
  // default config nothing is rebuilt and the downstream path is
  // byte-identical.
  let adjusted = form;
  if (email !== form.email) adjusted = { ...adjusted, email };
  if (note !== form.note) adjusted = { ...adjusted, note };
  if (
    union !== form.address.union ||
    division !== form.address.division ||
    district !== form.address.district ||
    upazila !== form.address.upazila
  ) {
    adjusted = {
      ...adjusted,
      address: { ...adjusted.address, union, division, district, upazila },
    };
  }
  return { ok: true, form: adjusted, noteText };
}

// In-process claim guard (double-submit inside this process) + the
// exact create-time EnrichedOrder per order id, so a same-process
// idempotent replay returns the order with its ORIGINAL coupon/fraud
// outcome (the DB row reconstructs it after a restart — see
// src/orders/repository.ts header for what is persisted vs derived).
const idempotencyStore = new InMemoryIdempotencyStore();
const enrichmentByOrderId = new Map<string, EnrichedOrder>();

export async function POST(req: Request) {
  await ensureDbFeatureFlags().catch(() => {});
  const body = await req.json().catch(() => null);
  // The saved checkout.fields config picks the parse schema: in
  // single address mode the cascade fields are optional (default
  // ""); in cascade mode the strict schema parses exactly as
  // before. The same config snapshot is threaded into the create
  // below, so the doc 28/29 gate enforces the mode the body was
  // parsed with. getCheckoutFieldsConfig is fail-soft (defaults on
  // any error), so this read can never take checkout down.
  const fieldsConfig = await getCheckoutFieldsConfig();
  const parsed = (
    fieldsConfig.addressMode === "single" ? createOrderBodySingleSchema : createOrderBodySchema
  ).safeParse(body);
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
    const res = await processCreate(form, fieldsConfig);
    if (res.status >= 400) idempotencyStore.release(form.idempotencyKey);
    return res;
  } catch (err) {
    idempotencyStore.release(form.idempotencyKey);
    throw err;
  }
}

async function processCreate(
  form: CreateOrderBody,
  fieldsConfig: CheckoutFieldsConfig,
): Promise<NextResponse> {
  // Dynamic checkout fields (doc 28): enforce the merchant's saved
  // checkout.fields config before anything else — hidden
  // email/union/note values are dropped from the form the rest of
  // this flow sees, a missing required field refuses the create,
  // and the extra-field answers ride along to the create-time note
  // below. Default config -> the gate is a no-op. Single address
  // mode: the gate additionally normalises the cascade to "" (see
  // enforceCheckoutFields), so every downstream reader — shop
  // rules, the shipping engine, createOrderRecord — sees exactly
  // the address the order will store.
  const fieldsGate = await enforceCheckoutFields(form, fieldsConfig);
  if (!fieldsGate.ok) {
    return errorResponse(fieldsGate.code, fieldsGate.message, 400, fieldsGate.details);
  }
  form = fieldsGate.form;
  const checkoutFieldsNoteText = fieldsGate.noteText;
  // Doc 34 L7: funnel claims (context + bump) verified up front —
  // drop-not-fail inside the resolver; null = a plain order. The
  // bump line itself is appended after the item snapshots below,
  // priced from the same server snapshots as every other line.
  const funnelCtx = await resolveFunnelOrderContext(form);
  // Wave 59: fractional quantities are sellable ONLY on grocery
  // weighted variants (and must land on the pack's weight step) —
  // gated here, before any pricing, with a clear 400.
  const qtyGate = await validateOrderLineQuantities(form.items);
  if (!qtyGate.ok) {
    return errorResponse(qtyGate.code, qtyGate.message, 400, qtyGate.details);
  }
  // Restaurant selection (ADV-23, wave 56): a payload carrying
  // `restaurant` while module.restaurant is OFF is refused 403
  // FEATURE_LOCKED (a locked module never runs open); with the flag
  // ON the choice is validated against the effective
  // restaurant.config BEFORE pricing, and the validated spec rides
  // into createOrderRecord, which writes the KitchenTicket inside
  // the create transaction. No field -> ticket null -> the default
  // path below is byte-identical.
  const kitchenPrep = await prepareKitchenTicket(form.restaurant);
  if (!kitchenPrep.ok) {
    return errorResponse(kitchenPrep.code, kitchenPrep.message, kitchenPrep.httpStatus);
  }
  // Service booking (ADV-23 vertical 2, wave 56): a payload carrying
  // `booking` while module.services is OFF is refused 403
  // FEATURE_LOCKED; with the flag ON the choice is validated against
  // services.config + the order's own items BEFORE pricing, and the
  // validated spec rides into createOrderRecord, which writes the
  // ServiceBooking inside the create transaction and enforces slot
  // capacity there. No field -> booking null -> the default path
  // below is byte-identical.
  const bookingPrep = await prepareServiceBooking(form.booking, form.items);
  if (!bookingPrep.ok) {
    return errorResponse(bookingPrep.code, bookingPrep.message, bookingPrep.httpStatus);
  }
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
    // Wave 59: line totals use the single line-level rounding rule
    // (integer milli-units) — identical to unit × qty for integers.
    subtotalPoisha += lineTotalPoisha(server.unitPricePoisha, item.quantity);
    totalWeightGrams += roundHalfUpDiv(server.weightGrams * qtyToMilli(item.quantity), QTY_MILLI);
    categorySlugs.add(server.categorySlug);
  }

  // Doc 34 L7 (§3.7): the order bump joins HERE — after the item
  // snapshots, before shipping/coupon/fraud — so it prices, ships
  // and scores exactly like a normal line. The unit price is the
  // LIVE snapshot price minus the step's stored discount rule
  // (src/funnels/offer.ts math). DROP-NOT-FAIL: any problem (qty
  // rules, missing snapshot, insufficient stock, a rule that would
  // price the line at <= 0) logs and skips the line; the order
  // itself proceeds untouched.
  let funnelBumpRecord: FunnelOfferLineRecord | null = null;
  if (funnelCtx?.bumpVariantId && funnelCtx.bumpOffer) {
    const bumpOffer = funnelCtx.bumpOffer;
    try {
      const bumpQtyGate = await validateOrderLineQuantities([
        { variantId: funnelCtx.bumpVariantId, quantity: 1 },
      ]);
      const bumpSnap = bumpQtyGate.ok
        ? (await getVariantSnapshots([funnelCtx.bumpVariantId])).get(funnelCtx.bumpVariantId)
        : undefined;
      if (!bumpQtyGate.ok) {
        console.error("[funnels] bump line failed the quantity rules — bump dropped, order continues", bumpQtyGate);
      } else if (!bumpSnap) {
        console.error("[funnels] bump variant snapshot missing — bump dropped, order continues");
      } else {
        const availableStock =
          typesOn && bumpSnap.productType === "BUNDLE" && bumpSnap.bundleAvailability !== null
            ? bumpSnap.bundleAvailability
            : bumpSnap.stock;
        const discountPoisha = offerDiscountPoisha(bumpOffer, bumpSnap.unitPricePoisha);
        const chargedPoisha = bumpSnap.unitPricePoisha - discountPoisha;
        if (availableStock < 1) {
          console.error("[funnels] bump variant out of stock — bump dropped, order continues");
        } else if (chargedPoisha < 1) {
          console.error("[funnels] bump rule would price the line at <= 0 against the live price — bump dropped, order continues");
        } else {
          snapshotItems.push({
            variantId: bumpSnap.variantId,
            productName: bumpSnap.productName,
            sku: bumpSnap.sku,
            unitPricePoisha: chargedPoisha,
            quantity: 1,
          });
          subtotalPoisha += lineTotalPoisha(chargedPoisha, 1);
          totalWeightGrams += bumpSnap.weightGrams;
          categorySlugs.add(bumpSnap.categorySlug);
          funnelBumpRecord = {
            funnelId: funnelCtx.funnel.id,
            stepId: funnelCtx.stepId,
            kind: "bump",
            variantId: bumpSnap.variantId,
            discount: bumpOffer.discount,
            livePricePoisha: bumpSnap.unitPricePoisha,
            chargedPoisha,
          };
        }
      }
    } catch (e) {
      console.error("[funnels] bump append failed — bump dropped, order continues", e);
    }
  }

  // Rental (ADV-23 vertical 3, wave 56): a payload carrying
  // `rental` while module.rental is OFF is refused 403
  // FEATURE_LOCKED; with the flag ON the range is validated against
  // rental.config + the order's own items, and the validated spec
  // rides into createOrderRecord, which writes the RentalBooking
  // inside the create transaction and enforces window availability
  // there. This gate runs AFTER the snapshots — unlike the kitchen
  // / booking gates above — because a percent deposit derives from
  // the rental line's SERVER price (snapshotItems), never from the
  // client. The frozen deposit joins the pricing pipeline below
  // (pricingInput.rentalDepositPoisha). No field -> rental null ->
  // the default path below is byte-identical.
  const rentalPrep = await prepareRentalBooking(form.rental, snapshotItems);
  if (!rentalPrep.ok) {
    return errorResponse(rentalPrep.code, rentalPrep.message, rentalPrep.httpStatus);
  }

  // Print-on-demand (ADV-23 vertical 5, wave 56): a payload
  // carrying `pod` while module.print_on_demand is OFF is refused
  // 403 FEATURE_LOCKED; with the flag ON the customisation is
  // validated against pod.config + the order's own items (the
  // snapshot lines — the fee is per item on the line's quantity),
  // frozen onto the create-time note below, and its fee total
  // joins the pricing pipeline (pricingInput.printFeePoisha). No
  // field -> pod null -> the default path below is byte-identical.
  const podPrep = await preparePodCustomisation(form.pod, snapshotItems);
  if (!podPrep.ok) {
    return errorResponse(podPrep.code, podPrep.message, podPrep.httpStatus);
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
    // ADV-23 rental (wave 56): the frozen deposit for this order's
    // rental (0 for every non-rental order) — computePricing adds
    // it as its own breakdown line after the gift-card stage and
    // includes it in the grand total.
    rentalDepositPoisha: rentalPrep.rental?.depositPoisha ?? 0,
    // ADV-23 vertical 5 (wave 56): the frozen print fee for this
    // order's custom print (0 for every non-POD order) — its own
    // breakdown line at the same stage as the deposit.
    printFeePoisha: podPrep.pod?.feePoisha ?? 0,
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
        (lineTotalPoisha(server.unitPricePoisha, item.quantity) * server.preorderDepositPercent) / 100,
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
      // ADV-23 rental (wave 56): the rental window + deposit truth
      // rides the same create-time note seam, so the order timeline
      // in admin shows what was rented and what deposit the total
      // contains (the Order row has no deposit column — the frozen
      // figure lives on the RentalBooking row).
      rentalPrep.rental ? rentalOrderNoteText(rentalPrep.rental) : null,
      // Doc 28: the merchant-defined checkout fields' answers ride
      // the same create-time note seam — one human line per answer
      // (`label: value`) + the `[checkout-fields] {json}` machine
      // line. Present only when the config defines extra fields and
      // the customer answered at least one. Kept before the POD part
      // so the `[pod:]` machine line still ends the note.
      checkoutFieldsNoteText ?? null,
      // Doc 34 L7/§3.8: the funnel attribution record rides the
      // same create-time note seam (human line + the `[funnel]
      // {json}` machine line L9's analytics source parses back —
      // the Order model has no attribution columns). Present only
      // on a verified funnel order.
      funnelCtx
        ? funnelAttributionNoteText({ funnelId: funnelCtx.funnel.id, stepId: funnelCtx.stepId })
        : null,
      // Doc 34 L7/§3.7: the bump line's record (rule + live/charged
      // prices) rides the same seam — refunds/recon read exactly
      // what was charged and why. Present only when the bump line
      // actually joined the order.
      funnelBumpRecord
        ? funnelOfferNoteText(
            funnelBumpRecord,
            snapshotItems.find((i) => i.variantId === funnelBumpRecord.variantId)?.productName ?? "",
          )
        : null,
      // ADV-23 vertical 5 (wave 56): the custom print rides the
      // same create-time note seam — a human line the print shop
      // works from + the `[pod:{...}]` machine line the admin
      // projection and print queue parse back. There is no POD
      // table; this note IS the record. Kept LAST so the machine
      // line ends the note.
      podPrep.pod
        ? podOrderNoteText(
            podPrep.pod,
            snapshotItems.find((i) => i.variantId === podPrep.pod?.variantId)?.productName ?? "",
          )
        : null,
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
      incompleteSessionKey: form.checkoutSessionKey,
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
    // ADV-23 (wave 56): the validated kitchen-ticket spec (null for
    // every non-restaurant order) — written in the create transaction.
    kitchenTicket: kitchenPrep.ticket,
    // ADV-23 vertical 2 (wave 56): the validated booking write spec
    // (null for every non-booking order) — written in the create
    // transaction, capacity enforced there.
    serviceBooking: bookingPrep.booking,
    // ADV-23 vertical 3 (wave 56): the validated rental write spec
    // (null for every non-rental order) — written in the create
    // transaction, window availability enforced there; its line is
    // excluded from the generic stock reservation.
    rentalBooking: rentalPrep.rental,
    });
  } catch (err) {
    if (err instanceof BundleStockError) {
      return errorResponse("INSUFFICIENT_STOCK", err.message, 400, err.details);
    }
    // ADV-23 services (wave 56): the slot filled between the
    // availability read and this create — the transaction rolled
    // back in full (no order, no charge), so the customer can pick
    // another slot and retry.
    if (err instanceof ServiceBookingCapacityError) {
      return errorResponse("BOOKING_SLOT_FULL", err.message, 409);
    }
    // ADV-23 rental (wave 56): every unit for the requested window
    // went out between the availability read and this create — the
    // transaction rolled back in full (no order, no charge), so the
    // customer can pick other dates and retry.
    if (err instanceof RentalCapacityError) {
      return errorResponse("RENTAL_NOT_AVAILABLE", err.message, 409);
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

  // Doc 34 L7 (§3.7): funnel continuation. A verified funnel order
  // gets the signed funnel token (L8's module — HMAC over
  // { funnelId, orderId, exp }, 60-minute §5.4 window) and the
  // next-step URL per the graph's sequential edge: the offer chain
  // entry when the next step is an offer step, else the thank-you
  // step. The QuickOrderForm redirects there; without a next step
  // (order step last) or a mintable token (no signing secret) the
  // URL is null and the form shows its normal success panel. The
  // A/B conversion for the funnel's running experiments is recorded
  // through the L9 seam — guarded like every post-commit seam: a
  // failure never touches the committed create.
  let funnelContinuation: { nextStepUrl: string | null } | undefined;
  if (funnelCtx) {
    const token = createFunnelToken({ funnelId: funnelCtx.funnel.id, orderId: created.orderId });
    const next = nextStepAfter(funnelCtx.funnel, funnelCtx.stepId);
    funnelContinuation = {
      nextStepUrl:
        token && next
          ? `/f/${funnelCtx.funnel.slug}/${next.id}?t=${encodeURIComponent(token)}`
          : null,
    };
    try {
      const visitorId = cookies().get("ae_vid")?.value ?? null;
      const experiments = await import("@/marketing/experiments");
      await experiments.recordFunnelConversionForOrder(visitorId, created.orderId, funnelCtx.funnel.id);
    } catch {
      // The conversion simply is not recorded — analytics never
      // break a committed create.
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
      data: { order, pricing, ...(funnelContinuation ? { funnel: funnelContinuation } : {}) },
      meta: {
        db: "PRISMA",
        source: "DATABASE",
        // Doc 34 L7: present only on a verified funnel order —
        // bumpApplied says whether the bump line actually joined
        // (a dropped bump still attributes + continues).
        ...(funnelCtx
          ? {
              funnelAttribution: {
                funnelId: funnelCtx.funnel.id,
                stepId: funnelCtx.stepId,
                bumpApplied: funnelBumpRecord !== null,
              },
            }
          : {}),
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
        // ADV-23 (wave 56): restaurant outcome — present only when a
        // kitchen ticket was created with this order; the ticket
        // starts QUEUED and the customer watches it on /track.
        ...(kitchenPrep.ticket
          ? {
              restaurant: {
                fulfilmentType: kitchenPrep.ticket.fulfilmentType,
                tableLabel: kitchenPrep.ticket.tableLabel,
                kitchenStatus: "QUEUED",
              },
            }
          : {}),
        // ADV-23 vertical 2 (wave 56): booking outcome — present
        // only when a ServiceBooking was created with this order.
        ...(bookingPrep.booking
          ? {
              booking: {
                variantId: bookingPrep.booking.variantId,
                date: bookingPrep.booking.date,
                slotStart: bookingPrep.booking.slotStart,
                slotEnd: bookingPrep.booking.slotEnd,
                staffLabel: bookingPrep.booking.staffLabel,
                status: "BOOKED",
              },
            }
          : {}),
        // ADV-23 vertical 3 (wave 56): rental outcome — present
        // only when a RentalBooking was created with this order.
        // depositPoisha is the frozen deposit already included in
        // the order total (see the pricing breakdown's
        // rentalDepositPoisha line); its refund on return is a
        // manual admin action in v1.
        ...(rentalPrep.rental
          ? {
              rental: {
                variantId: rentalPrep.rental.variantId,
                startDate: rentalPrep.rental.startDate,
                endDate: rentalPrep.rental.endDate,
                days: rentalPrep.rental.days,
                depositPoisha: rentalPrep.rental.depositPoisha,
                depositLabelBn: "ভাড়ার জামানত (ফেরতযোগ্য)",
                status: "ACTIVE",
              },
            }
          : {}),
        // ADV-23 vertical 5 (wave 56): print-on-demand outcome —
        // present only when a custom print was frozen with this
        // order. feePoisha is the total print fee already included
        // in the order total (see the pricing breakdown's
        // printFeePoisha line); the confirmation screen shows the
        // customer exactly what will be printed.
        ...(podPrep.pod
          ? {
              pod: {
                variantId: podPrep.pod.variantId,
                printText: podPrep.pod.printText,
                printColor: podPrep.pod.printColor,
                feePoisha: podPrep.pod.feePoisha,
              },
            }
          : {}),
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
