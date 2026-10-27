/**
 * POST /api/v1/public/track — public order tracking. Agent 19.
 *
 * Body (POST, so the phone never lands in a URL or access log):
 *   { orderNo, phone }
 * Phone must match the order's phone (normalized compare). Not-found and
 * phone-mismatch return the identical generic 404 — no enumeration.
 * Rate limit: 10 lookups / 5 min / IP via the shared Redis limiter
 * (src/lib/rate-limit.ts; process-local fallback only when Redis is
 * unreachable — the meta reports which backend answered).
 *
 * DB-BACKED: the order is looked up by orderNo in Prisma (via
 * src/orders/repository) and handed to lookupTracking as a one-element
 * list, so the generic not-found/phone-mismatch behaviour is unchanged.
 * The order's real Shipment rows + ShipmentEvent history are read via
 * src/shipments/tracking.ts and passed along: when they exist the view
 * is per-parcel from real courier data (meta.shipmentSource
 * "shipments"); orders without any Shipment row get the labelled
 * order-status-derived fallback ("order-status"). Shipments are
 * fetched server-side only — on a phone mismatch lookupTracking still
 * returns the generic 404 and nothing about them leaks.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrderByOrderNo } from "@/orders/repository";
import { getTrackingShipmentsForOrder } from "@/shipments/tracking";
import { getKitchenTicketView } from "@/restaurant/tickets";
import { getOrderWorkflowStageView } from "@/orders/stages";
import { lookupTracking } from "@/storefront-ux/order-tracking";
import { getRequestLocale } from "@/i18n/server";
import { checkRateLimit } from "@/lib/rate-limit";

const trackBodySchema = z.object({
  orderNo: z.string().min(3).max(40),
  phone: z.string().min(11).max(15),
});

export async function POST(req: Request) {
  // Doc 30: every message this route returns follows the request locale
  // (visitor cookie → store default), like the /track page itself.
  const locale = await getRequestLocale();
  const isBn = locale === "bn";
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0]?.trim() || "unknown";
  const limit = await checkRateLimit(`track:ip:${ip}`, 10, 5 * 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: isBn ? "অনেকবার চেষ্টা করা হয়েছে — কিছুক্ষণ পর আবার চেষ্টা করুন।" : "Too many attempts — please try again in a little while." } },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  const parsed = trackBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: isBn ? "অর্ডার নম্বর ও সঠিক মোবাইল নম্বর দিন।" : "Enter the order number and a valid mobile number.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const order = await getOrderByOrderNo(parsed.data.orderNo.trim().toUpperCase());
  const shipments = order ? await getTrackingShipmentsForOrder(order.id) : [];
  // ADV-23 (wave 56): the order's kitchen ticket, when it has one —
  // fetched server-side only and attached by lookupTracking solely
  // on a phone match (same no-leak discipline as the shipments).
  const kitchen = order ? await getKitchenTicketView(order.id) : null;
  // ADV-26 (BUILD-LITE): the order's merchant workflow stage, when
  // set and the module is ON (the helper is flag-gated + fail-soft)
  // — attached by lookupTracking solely on a phone match, same
  // no-leak discipline as the kitchen ticket above.
  const stageView = order ? await getOrderWorkflowStageView(order.id) : null;
  const workflowStage = stageView ? { labelBn: stageView.labelBn, labelEn: stageView.labelEn } : null;
  const result = lookupTracking(order ? [order] : [], parsed.data.orderNo, parsed.data.phone, shipments, kitchen, workflowStage, locale);
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: result.message } },
      { status: 404 },
    );
  }
  return NextResponse.json({
    data: { tracking: result.view },
    meta: {
      source: "DATABASE",
      shipmentSource: result.view.shipmentSource,
      rateLimit: "10 requests / 5 min / IP",
      rateLimitBackend: limit.backend,
    },
  });
}
