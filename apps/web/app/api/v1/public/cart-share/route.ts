/**
 * POST /api/v1/public/cart-share — mint a signed cart-share link
 * (ADV-19, doc 22). Body: { lines: [{ variantId, quantity }] }.
 * Returns { token, path, expiresAt }. NO server persistence: the
 * HMAC-signed token (src/cart-share/token) is the whole share, and
 * the /cart/shared page re-resolves prices/stock live — nothing in
 * the token is trusted for money.
 *
 * The lines are NOT validated against the catalog here on purpose:
 * a variant that later leaves the catalog simply resolves as
 * unavailable on the shared page. Signing refuses (503) when no
 * server signing key is configured — honestly, instead of minting an
 * unverifiable link.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { createCartShareToken, isCartShareConfigured } from "@/cart-share/token";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  lines: z
    .array(z.object({ variantId: z.string().min(1).max(128), quantity: z.number().int().min(1).max(999) }))
    .min(1)
    .max(50),
});

export async function POST(req: Request) {
  if (!isCartShareConfigured()) {
    return NextResponse.json(
      { error: { code: "NOT_CONFIGURED", message: "কার্ট শেয়ার এই মুহূর্তে চালু নেই / Cart sharing is not configured on this server." } },
      { status: 503 },
    );
  }
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Share lines invalid.",
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
      },
      { status: 400 },
    );
  }
  const token = createCartShareToken(parsed.data.lines);
  if (!token) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Share lines invalid." } },
      { status: 400 },
    );
  }
  return NextResponse.json({
    data: { token, path: `/cart/shared?t=${token}` },
    meta: { persistence: "none — the signed token is the share", ttlDays: 7 },
  });
}
