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
 * TEMPORARY: orders come from src/orders/mock.ts (TEMPORARY MOCK). The DB
 * version replaces MOCK_ORDERS with an Order lookup by orderNo + its
 * Shipment row for a real ShipmentStatus; lookupTracking's contract and
 * the response shape do not change.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { MOCK_ORDERS } from "@/orders/mock";
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
  const result = lookupTracking(MOCK_ORDERS, parsed.data.orderNo, parsed.data.phone);
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: result.messageBn } },
      { status: 404 },
    );
  }
  return NextResponse.json({
    data: { tracking: result.view },
    meta: { source: "TEMPORARY_MOCK", rateLimit: "10 requests / 5 min / IP" },
  });
}
