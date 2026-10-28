/**
 * Funnel offer accept — doc 34 §3.7 (wave L8). The ONLY runtime
 * that turns an upsell/downsell accept into money movement, and it
 * moves money exclusively through the platform's order machinery:
 *
 *   1. AMEND (primary): the discounted line is appended to the
 *      SAME order by `src/orders/edit.ts` (editOrderItems) — its
 *      transaction recomputes pricing/shipping/coupon/VAT and moves
 *      the stock ledger, exactly like a staff edit. The discount is
 *      an INPUT the service validates against its own catalog
 *      snapshot (discount-only, never above catalog); no total is
 *      ever computed here.
 *   2. FALLBACK (when edit.ts refuses — bundle offer variant,
 *      oversell, already shipped, priced-merge conflict): a HELD
 *      second order is created through createOrderRecord — the same
 *      funnel the public route and the abandoned-checkout
 *      conversion use (live snapshots, shipping engine,
 *      computePricing, fraud scoring) — priced with the same
 *      server-computed discount, cross-referenced by notes on BOTH
 *      orders and held (heldAt/heldReason) for staff to merge via
 *      src/orders/merge.ts or ship as a companion parcel.
 *
 * Guards are ALL server-side (the step page's checks are UX only):
 * signed token (signature + expiry), order number ↔ token binding,
 * phone match against the order row (the §3.7 ownership re-proof),
 * funnel PUBLISHED, step is an offer step of that funnel, §5.4
 * window (60 minutes from order creation, token expiry — whichever
 * ends first), COD + not-yet-paid only (§5.4: a prepaid upsell has
 * no collection path), terminal order states refused outright.
 *
 * Idempotency is two-layered like checkout's: a durable marker
 * OrderNote (`[funnel-accept:<stepId>]`) written on every completed
 * accept + the route's in-process claim for concurrent double-taps.
 * A replayed accept returns the original outcome — the line is
 * never added twice. The fallback's create carries a deterministic
 * idempotency key, so even a crash-retry adopts the same order.
 */
import { prisma } from "@advance-ecommerce/db";
import { landingCatalogQueriesPublic } from "@/landing/catalog";
import { editOrderItems } from "@/orders/edit";
import {
  createOrderRecord,
  findOrderByIdempotencyKey,
  getVariantSnapshots,
  listOrdersByPhone,
  orderRowToEnriched,
} from "@/orders/repository";
import { publishOrderCreated } from "@/orders/event-bus";
import {
  ADVANCE_REASON_LABELS,
  percentAdvancePoisha,
  pickAdvanceRequirement,
  type AdvanceCandidate,
} from "@/orders/advance";
import { computeOrderShipping, zoneForDistrict } from "@/checkout/shipping";
import { computePricing } from "@/checkout/pricing";
import { assembleFraudInput, fraudEnforcement } from "@/checkout/order-enrichment";
import { loadOrderRules } from "@/checkout/order-rules";
import { normalizeBdPhone, type BdAddress } from "@/checkout/validation";
import { scoreFraud } from "@/fraud/scoring";
import {
  BundleStockError,
  PreorderCapError,
  productTypesEnabledInDb,
} from "@/catalog/product-types";
import { recordFunnelConversionForOrder } from "@/marketing/experiments";
import { funnelStore } from "./store";
import { verifyFunnelToken, FUNNEL_TOKEN_TTL_MS } from "./token";
import { resolveStepOffer, type ResolvedStepOffer } from "./offer";
import type { Funnel, FunnelStep, StepOffer } from "./types";

export type FunnelAmendResult =
  | {
      ok: true;
      path: "amended" | "fallback_order" | "already_applied";
      orderNo: string;
      /** The ORIGINAL order's total after the accept (unchanged on the fallback path). */
      totalPoisha: number;
      fallbackOrderNo: string | null;
      /** Where an accept routes next (the step's configured target). */
      acceptStepId: string;
      funnelSlug: string;
    }
  | { ok: false; code: string; messageBn: string; messageEn: string; httpStatus: number };

const fail = (
  code: string,
  messageBn: string,
  messageEn: string,
  httpStatus: number,
): FunnelAmendResult => ({ ok: false, code, messageBn, messageEn, httpStatus });

type OfferStep = Extract<FunnelStep, { kind: "upsell" | "downsell" }>;

/** Order states where an accept must not resurrect anything —
 *  no amend, no companion order (merge/companion semantics break). */
const TERMINAL_REFUSAL_STATUSES: ReadonlySet<string> = new Set([
  "CANCELLED",
  "REFUNDED",
  "RETURNED",
  "RETURN_REQUESTED",
  "RETURNING",
  "FAILED",
  "EXCHANGED",
]);

function markerFor(stepId: string): string {
  return `[funnel-accept:${stepId}]`;
}

function ruleTextBn(offer: StepOffer): string {
  if (!offer.discount) return "ছাড় ছাড়া (পূর্ণ দামে)";
  return offer.discount.kind === "percent"
    ? `${offer.discount.pct}% ছাড়`
    : `${offer.discount.poisha} পয়সা ছাড়`;
}

function ruleTextEn(offer: StepOffer): string {
  if (!offer.discount) return "no discount (full price)";
  return offer.discount.kind === "percent"
    ? `${offer.discount.pct}% off`
    : `${offer.discount.poisha} poisha off`;
}

interface AcceptContext {
  funnel: Funnel;
  step: OfferStep;
  resolved: ResolvedStepOffer;
  order: {
    id: string;
    orderNo: string;
    customerName: string;
    customerPhone: string;
    division: string;
    district: string;
    upazila: string;
    union: string | null;
    addressLine: string;
    totalPoisha: number;
  };
}

async function writeMarkerNote(ctx: AcceptContext, path: "amended" | "fallback", fallbackOrderNo: string | null): Promise<void> {
  const { funnel, step, resolved, order } = ctx;
  const text =
    `${markerFor(step.id)} path=${path}${fallbackOrderNo ? ` fallbackOrderNo=${fallbackOrderNo}` : ""} — ` +
    `ফানেল অফার গৃহীত হয়েছে: ফানেল "${funnel.name}" (${funnel.id}), ${step.kind} ধাপ ${step.id}। ` +
    `${resolved.sku}: ক্যাটালগ দাম ${resolved.livePricePoisha} পয়সা → নেওয়া হয়েছে ${resolved.finalPricePoisha} পয়সা (${ruleTextBn(step.offer)})। ` +
    (path === "amended"
      ? `লাইনটি এই অর্ডারেই যোগ হয়েছে; মোট অর্ডার সম্পাদনা সেবা দিয়ে পুনরায় হিসাব করা হয়েছে।`
      : `লাইনটি এই অর্ডারে যোগ করা যায়নি — আলাদা হোল্ড-করা অর্ডার ${fallbackOrderNo} তৈরি হয়েছে; মার্জ করুন অথবা সঙ্গী পার্সেল হিসেবে পাঠান।`) +
    ` / Funnel offer accepted: funnel "${funnel.name}" (${funnel.id}), ${step.kind} step ${step.id}. ` +
    `${resolved.sku}: catalog ${resolved.livePricePoisha} poisha → charged ${resolved.finalPricePoisha} poisha (${ruleTextEn(step.offer)}). ` +
    (path === "amended"
      ? `The line was appended to THIS order; totals were recomputed by the order edit service.`
      : `The line could not be amended into this order — held order ${fallbackOrderNo} was created instead; merge it or ship it as a companion parcel.`);
  await prisma.orderNote.create({ data: { orderId: order.id, authorId: null, text } });
}

async function recordConversion(visitorId: string | null, orderId: string, funnelId: string): Promise<void> {
  // Analytics never fail an accept (the seam itself dedupes per order).
  await recordFunnelConversionForOrder(visitorId, orderId, funnelId).catch(() => []);
}

/**
 * The held-second-order fallback (§3.7). Priced with the same
 * server-computed discount as the amend would have used; totals
 * come from the shipping engine + computePricing; fraud scoring
 * runs exactly like the abandoned-checkout conversion.
 */
async function createFallbackOrder(
  ctx: AcceptContext,
  amendRefusalCode: string,
): Promise<{ orderId: string; orderNo: string } | FunnelAmendResult> {
  const { funnel, step, resolved, order } = ctx;
  const snapshots = await getVariantSnapshots([resolved.variantId]);
  const snap = snapshots.get(resolved.variantId);
  if (!snap) {
    return fail("OFFER_UNAVAILABLE", "অফারের পণ্যটি এখন পাওয়া যাচ্ছে না।", "The offer product is no longer available.", 409);
  }
  const typesOn = await productTypesEnabledInDb();
  const availableStock =
    typesOn && snap.productType === "BUNDLE" && snap.bundleAvailability !== null
      ? snap.bundleAvailability
      : snap.stock;
  if (availableStock < 1) {
    return fail(
      "INSUFFICIENT_STOCK",
      "দুঃখিত, অফারের পণ্যটির স্টক এই মুহূর্তে শেষ।",
      "Sorry, the offer product is out of stock right now.",
      409,
    );
  }

  const subtotalPoisha = resolved.finalPricePoisha;
  const shipping = await computeOrderShipping({
    district: order.district,
    shippingMethod: zoneForDistrict(order.district),
    totalWeightGrams: snap.weightGrams,
    subtotalPoisha,
  });
  const pricing = computePricing({
    itemsSubtotalPoisha: subtotalPoisha,
    couponDiscountPoisha: 0,
    shippingPoisha: shipping.shippingPoisha,
    codFeePoisha: shipping.codFeePoisha,
    taxBps: 0,
  });

  const priorOrders = await listOrdersByPhone(order.customerPhone);
  const assessment = scoreFraud(
    await assembleFraudInput({
      phone: order.customerPhone,
      address: { division: order.division, district: order.district, upazila: order.upazila },
      paymentMethod: "cod",
      totalPoisha: pricing.grandTotalPoisha,
      itemKeys: [resolved.variantId],
      priorOrders,
      now: new Date().toISOString(),
    }),
  );
  const enforcement = fraudEnforcement(assessment);
  if (enforcement.blocked) {
    return fail(
      "FRAUD_BLOCKED",
      "দুঃখিত, অফারটি যোগ করা যাচ্ছে না। সহায়তার জন্য আমাদের সাথে যোগাযোগ করুন।",
      "Sorry, the offer cannot be added. Please contact support for help.",
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

  const address: BdAddress = {
    division: order.division,
    district: order.district,
    upazila: order.upazila,
    union: order.union || undefined,
    addressLine: order.addressLine,
  };
  const note =
    `ফানেল আপসেল ফলব্যাক — মূল অর্ডার ${order.orderNo}-তে অফারটি সরাসরি যোগ করা যায়নি (সম্পাদনা সেবা ফিরিয়েছে: ${amendRefusalCode})। ` +
    `ফানেল "${funnel.name}" (${funnel.id}), ${step.kind} ধাপ ${step.id}। ${resolved.sku}: ক্যাটালগ দাম ${resolved.livePricePoisha} পয়সা → নেওয়া হয়েছে ${resolved.finalPricePoisha} পয়সা (${ruleTextBn(step.offer)})। ` +
    `এই অর্ডারটি হোল্ড করা আছে — ${order.orderNo}-এর সাথে মার্জ করুন (অর্ডার → মার্জ) অথবা সঙ্গী পার্সেল হিসেবে পাঠান। ` +
    `/ Funnel upsell fallback — the accepted offer could not be amended into order ${order.orderNo} (edit service refused: ${amendRefusalCode}). ` +
    `Funnel "${funnel.name}" (${funnel.id}), ${step.kind} step ${step.id}. ${resolved.sku}: catalog ${resolved.livePricePoisha} poisha → charged ${resolved.finalPricePoisha} poisha (${ruleTextEn(step.offer)}). ` +
    `This order is HELD — merge it with ${order.orderNo} (Orders → Merge) or ship it as a companion parcel.`;

  const idempotencyKey = `funnel-fallback-${order.id}-${step.id}`;
  let created: Awaited<ReturnType<typeof createOrderRecord>>;
  try {
    created = await createOrderRecord({
      idempotencyKey,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      address,
      items: [
        {
          variantId: snap.variantId,
          productName: snap.productName,
          sku: snap.sku,
          unitPricePoisha: resolved.finalPricePoisha,
          quantity: 1,
        },
      ],
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
      note,
      source: "funnel",
    });
  } catch (e) {
    if (e instanceof BundleStockError) {
      return fail("INSUFFICIENT_STOCK", e.message, e.message, 409);
    }
    if (e instanceof PreorderCapError) {
      return fail("PREORDER_CAP_REACHED", e.message, e.message, 409);
    }
    throw e;
  }

  let fallbackOrderId: string;
  let fallbackOrderNo: string;
  if (created.replayed) {
    // A concurrent or crashed-earlier attempt already created it —
    // adopt that order (the deterministic key is the guarantee).
    fallbackOrderId = created.existing.id;
    fallbackOrderNo = created.existing.orderNo;
  } else {
    fallbackOrderId = created.orderId;
    fallbackOrderNo = created.orderNo;
    const storedRow = await findOrderByIdempotencyKey(idempotencyKey);
    if (storedRow) publishOrderCreated(orderRowToEnriched(storedRow));
  }

  // The hold is real, not cosmetic: heldAt/heldReason are the
  // management module's own columns (UI-level; the status funnel
  // never consults them, so the merge path stays open).
  await prisma.order.update({
    where: { id: fallbackOrderId },
    data: {
      heldAt: new Date(),
      heldReason: `Funnel upsell fallback for ${order.orderNo} — merge with it or ship as a companion parcel.`,
    },
  });

  return { orderId: fallbackOrderId, orderNo: fallbackOrderNo };
}

/**
 * Accept one funnel offer step against one order. See the file
 * header for the guard list and the two money paths.
 */
export async function acceptFunnelOffer(input: {
  orderNo: string;
  token: string;
  phone: string;
  stepId: string;
  visitorId: string | null;
  ip?: string;
  userAgent?: string;
}): Promise<FunnelAmendResult> {
  /* ---- token ---- */
  const verified = verifyFunnelToken(input.token);
  if (!verified.ok) {
    if (verified.reason === "expired") {
      return fail("FUNNEL_TOKEN_EXPIRED", "এই অফারের সময় শেষ হয়ে গেছে। আপনার অর্ডারটি আগের মতোই নিরাপদ আছে।", "This offer has expired. Your order is safe, exactly as placed.", 410);
    }
    if (verified.reason === "not_configured") {
      return fail("FUNNEL_NOT_CONFIGURED", "অফার সেবাটি এখন পাওয়া যাচ্ছে না।", "The offer service is not available right now.", 503);
    }
    return fail("FUNNEL_TOKEN_INVALID", "এই লিংকটি সঠিক নয়।", "This link is not valid.", 401);
  }

  /* ---- order + ownership re-proof (§3.7) ---- */
  const order = await prisma.order.findFirst({
    where: { orderNo: input.orderNo, deletedAt: null },
    select: {
      id: true,
      orderNo: true,
      customerName: true,
      customerPhone: true,
      division: true,
      district: true,
      upazila: true,
      union: true,
      addressLine: true,
      status: true,
      paymentMethod: true,
      paymentStatus: true,
      totalPoisha: true,
      createdAt: true,
    },
  });
  if (!order) {
    return fail("ORDER_NOT_FOUND", "অর্ডারটি পাওয়া যায়নি।", "Order not found.", 404);
  }
  if (order.id !== verified.orderId) {
    return fail("TOKEN_ORDER_MISMATCH", "এই লিংকটি এই অর্ডারের জন্য নয়।", "This link does not belong to this order.", 403);
  }
  const phone = normalizeBdPhone(input.phone);
  if (phone === null || phone !== order.customerPhone) {
    return fail(
      "PHONE_MISMATCH",
      "ফোন নম্বরটি অর্ডারের নম্বরের সাথে মিলছে না। অর্ডারের সময় দেওয়া নম্বরটি দিন।",
      "The phone number does not match the order. Use the number given at order time.",
      403,
    );
  }

  /* ---- funnel + step ---- */
  const funnel = await funnelStore.get(verified.funnelId);
  if (!funnel) {
    return fail("FUNNEL_NOT_FOUND", "ফানেলটি পাওয়া যায়নি।", "Funnel not found.", 404);
  }
  if (funnel.status !== "PUBLISHED") {
    return fail("FUNNEL_NOT_ACTIVE", "এই ফানেলটি এখন সক্রিয় নেই।", "This funnel is no longer active.", 409);
  }
  const step = funnel.steps.find((s) => s.id === input.stepId);
  if (!step) {
    return fail("STEP_NOT_FOUND", "অফারের ধাপটি পাওয়া যায়নি।", "Offer step not found.", 404);
  }
  if (step.kind !== "upsell" && step.kind !== "downsell") {
    return fail("STEP_NOT_OFFER", "এই ধাপটি কোনো অফার ধাপ নয়।", "This step is not an offer step.", 400);
  }

  /* ---- order-state guards (§5.4) ---- */
  if (TERMINAL_REFUSAL_STATUSES.has(order.status)) {
    return fail(
      "ORDER_CLOSED",
      "এই অর্ডারটি আর পরিবর্তন করা যাবে না।",
      "This order can no longer be changed.",
      409,
    );
  }
  if (order.paymentMethod !== "COD" || order.paymentStatus === "PAID") {
    return fail(
      "PREPAID_NOT_SUPPORTED",
      "আগাম পেমেন্ট করা অর্ডারে এই অফারটি যোগ করা যায় না।",
      "This offer cannot be added to a prepaid order.",
      409,
    );
  }
  if (Date.now() - order.createdAt.getTime() > FUNNEL_TOKEN_TTL_MS) {
    return fail(
      "OFFER_WINDOW_EXPIRED",
      "এই অফারের সময় শেষ হয়ে গেছে। আপনার অর্ডারটি আগের মতোই নিরাপদ আছে।",
      "This offer's window has expired. Your order is safe, exactly as placed.",
      410,
    );
  }

  /* ---- idempotency: a completed accept never runs twice ---- */
  const marker = await prisma.orderNote.findFirst({
    where: { orderId: order.id, text: { contains: markerFor(step.id) } },
    select: { text: true },
  });
  if (marker) {
    const m = /fallbackOrderNo=([A-Za-z0-9-]+)/.exec(marker.text);
    return {
      ok: true,
      path: "already_applied",
      orderNo: order.orderNo,
      totalPoisha: order.totalPoisha,
      fallbackOrderNo: m ? m[1] : null,
      acceptStepId: step.acceptStepId,
      funnelSlug: funnel.slug,
    };
  }

  /* ---- resolve the offer against the LIVE catalog ---- */
  const catalog = await landingCatalogQueriesPublic.byIds([step.offer.productId]);
  const resolved = resolveStepOffer(step.offer, catalog);
  if (!resolved) {
    // Product/variant vanished, or the discount rule would price
    // the line at <= 0 against today's live price (§3.8) — logged,
    // never charged, never silently free.
    console.error(
      `funnel amend: offer unresolvable (funnel=${funnel.id} step=${step.id} order=${order.orderNo} product=${step.offer.productId})`,
    );
    return fail(
      "OFFER_UNAVAILABLE",
      "দুঃখিত, এই অফারটি এখন পাওয়া যাচ্ছে না।",
      "Sorry, this offer is not available right now.",
      409,
    );
  }

  const ctx: AcceptContext = {
    funnel,
    step,
    resolved,
    order: {
      id: order.id,
      orderNo: order.orderNo,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      division: order.division,
      district: order.district,
      upazila: order.upazila,
      union: order.union,
      addressLine: order.addressLine,
      totalPoisha: order.totalPoisha,
    },
  };

  /* ---- primary path: amend the SAME order through edit.ts ---- */
  const edit = await editOrderItems(
    order.id,
    { addItems: [{ variantId: resolved.variantId, quantity: 1, unitPricePoisha: resolved.finalPricePoisha }] },
    { id: "system", ip: input.ip, userAgent: input.userAgent },
  );
  if (edit.ok) {
    await writeMarkerNote(ctx, "amended", null);
    await recordConversion(input.visitorId, order.id, funnel.id);
    return {
      ok: true,
      path: "amended",
      orderNo: order.orderNo,
      totalPoisha: edit.value.after.totalPoisha,
      fallbackOrderNo: null,
      acceptStepId: step.acceptStepId,
      funnelSlug: funnel.slug,
    };
  }

  /* ---- fallback: held second order (§3.7, designed degradation) ---- */
  console.error(
    `funnel amend: edit refused (funnel=${funnel.id} step=${step.id} order=${order.orderNo} code=${edit.code}) — falling back to a held second order`,
  );
  const fallback = await createFallbackOrder(ctx, edit.code);
  if ("ok" in fallback) return fallback; // typed failure (stock/fraud/idempotency)
  await writeMarkerNote(ctx, "fallback", fallback.orderNo);
  await recordConversion(input.visitorId, order.id, funnel.id);
  return {
    ok: true,
    path: "fallback_order",
    orderNo: order.orderNo,
    totalPoisha: order.totalPoisha,
    fallbackOrderNo: fallback.orderNo,
    acceptStepId: step.acceptStepId,
    funnelSlug: funnel.slug,
  };
}
