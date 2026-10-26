/**
 * Abandoned-checkout capture — POST /api/v1/public/checkout/capture
 * (wave 22, doc 17 batch O4).
 *
 * The storefront checkout posts { sessionKey, phone, name?, items,
 * address? } once a valid BD phone is typed and the cart is non-empty
 * (debounced + a pagehide send). The service snapshots CATALOG prices
 * server-side and upserts one AbandonedCheckout row per session.
 *
 * Privacy by design: the response carries only the capture id + its
 * status (never the phone, never item prices), and there is NO public
 * GET for captures. Rate-limited per (phone + IP) through the shared
 * Redis-backed limiter (src/checkout/rate-limit.ts).
 */
import { NextResponse } from "next/server";
import {
  AbandonedError,
  abandonedCaptureRateKey,
  captureAbandonedCheckout,
  captureAbandonedSchema,
} from "@/checkout/abandoned";
import { checkAbandonedCaptureRateLimit } from "@/checkout/rate-limit";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  const rawPhone =
    typeof body === "object" && body !== null && typeof (body as { phone?: unknown }).phone === "string"
      ? ((body as { phone: string }).phone)
      : "";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = await checkAbandonedCaptureRateLimit(abandonedCaptureRateKey(rawPhone, ip));
  if (!limit.allowed) {
    return err(
      "RATE_LIMITED",
      "অনেকবার চেষ্টা করা হয়েছে — কিছুক্ষণ পরে আবার চেষ্টা করুন। / Too many attempts — please retry shortly.",
      429,
      { retryAfterSeconds: limit.retryAfterSeconds },
    );
  }

  const parsed = captureAbandonedSchema.safeParse(body);
  if (!parsed.success) {
    return err(
      "VALIDATION_ERROR",
      "Capture input invalid.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }

  try {
    const result = await captureAbandonedCheckout(parsed.data);
    return NextResponse.json(
      { data: { id: result.id, status: result.status } },
      { status: 200 },
    );
  } catch (e) {
    if (e instanceof AbandonedError) {
      return err(e.code, e.message, e.status, e.details);
    }
    throw e;
  }
}

export function GET() {
  return err("METHOD_NOT_ALLOWED", "Captures are write-only from the storefront.", 405);
}
