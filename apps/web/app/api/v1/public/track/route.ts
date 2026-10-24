/**
 * POST /api/v1/public/track — public order tracking. Agent 19.
 *
 * Body (POST, so the phone never lands in a URL or access log):
 *   { orderNo, phone }
 * Phone must match the order's phone (normalized compare). Not-found and
 * phone-mismatch return the identical generic 404 — no enumeration.
 * Rate limit: 10 lookups / 5 min / IP (in-memory demo limiter; production
 * swaps it for Redis — see src/storefront-ux/order-tracking.ts).
 *
 * DB-BACKED: the order is looked up by orderNo in Prisma (via
 * src/orders/repository) and handed to lookupTracking as a one-element
 * list, so the generic not-found/phone-mismatch behaviour and the
 * response shape are byte-identical to the mock era. ShipmentStatus is
 * still derived from the order status by lookupTracking (real Shipment
 * rows are the shipments slice).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrderByOrderNo } from "@/orders/repository";
import { lookupTracking, trackingRateLimiter } from "@/storefront-ux/order-tracking";

const trackBodySchema = z.object({
  orderNo: z.string().min(3).max(40),
  phone: z.string().min(11).max(15),
});

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0]?.trim() || "unknown";
  const limit = trackingRateLimiter.check(ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "অনেকবার চেষ্টা করা হয়েছে — কিছুক্ষণ পর আবার চেষ্টা করুন।" } },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  const parsed = trackBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "অর্ডার নম্বর ও সঠিক মোবাইল নম্বর দিন।", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const order = await getOrderByOrderNo(parsed.data.orderNo.trim().toUpperCase());
  const result = lookupTracking(order ? [order] : [], parsed.data.orderNo, parsed.data.phone);
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: result.messageBn } },
      { status: 404 },
    );
  }
  return NextResponse.json({
    data: { tracking: result.view },
    meta: { source: "DATABASE", rateLimit: "10 requests / 5 min / IP" },
  });
}
