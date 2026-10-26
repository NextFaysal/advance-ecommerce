/**
 * Partner API support — ADV-26 (doc 22).
 *
 * requirePartnerScope(req, scope) is the one gate every
 * /api/v1/partner route runs: Bearer key → authenticatePartnerKey
 * (401 unknown/revoked) → scope check (403) → per-key rate limit via
 * the shared Redis limiter (429). It reads the Authorization header
 * from the Request directly (no next/headers), so route handlers
 * stay plain functions.
 *
 * Serialisers mirror the admin products/orders shapes with the
 * partner exclusions applied at the Prisma select level — cost
 * fields and PII never leave the database layer:
 *  - products: no costPoisha anywhere (variants are selected field
 *    by field, so a future cost column can't leak by accident);
 *  - orders: phone only as maskPhone() output; no customer name, no
 *    address fields, no email.
 */
import { NextResponse } from "next/server";
import { prisma } from "@advance-ecommerce/db";
import { maskPhone } from "@advance-ecommerce/validators";
import { checkRateLimit } from "../lib/rate-limit";
import { authenticatePartnerKey, type AuthenticatedPartnerKey, type PartnerScope } from "./api-keys";

/** Per-key partner rate limit: 120 requests / minute. */
export const PARTNER_RATE_LIMIT = { max: 120, windowMs: 60_000 } as const;

export type PartnerGuard =
  | { ok: true; key: AuthenticatedPartnerKey }
  | { ok: false; response: NextResponse };

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function requirePartnerScope(req: Request, scope: PartnerScope): Promise<PartnerGuard> {
  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (presented === "") {
    return { ok: false, response: errorResponse(401, "UNAUTHENTICATED", "API key required (Authorization: Bearer ae_live_…).") };
  }
  const key = await authenticatePartnerKey(presented);
  if (!key) {
    return { ok: false, response: errorResponse(401, "UNAUTHENTICATED", "API key is invalid or revoked.") };
  }
  if (!key.scopes.includes(scope)) {
    return { ok: false, response: errorResponse(403, "FORBIDDEN", `This key lacks the ${scope} scope.`) };
  }
  const limit = await checkRateLimit(
    `partner:${key.id}`,
    PARTNER_RATE_LIMIT.max,
    PARTNER_RATE_LIMIT.windowMs,
  );
  if (!limit.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Partner API rate limit exceeded." } },
        { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
      ),
    };
  }
  return { ok: true, key };
}

/* ------------------------------------------------------------------ */
/* Serialisers (partner-safe selects)                                  */
/* ------------------------------------------------------------------ */

export async function listPartnerProducts(limit: number) {
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      slug: true,
      titleBn: true,
      titleEn: true,
      status: true,
      type: true,
      priceOnRequest: true,
      tags: true,
      updatedAt: true,
      variants: {
        where: { deletedAt: null },
        select: {
          id: true,
          sku: true,
          pricePoisha: true,
          compareAtPoisha: true,
          stock: true,
          isActive: true,
          // costPoisha deliberately NOT selected — never leaves the DB.
        },
      },
    },
  });
  return products.map((p) => ({ ...p, updatedAt: p.updatedAt.toISOString() }));
}

export async function listPartnerOrders(limit: number) {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      orderNo: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      subtotalPoisha: true,
      discountPoisha: true,
      shippingPoisha: true,
      totalPoisha: true,
      customerPhone: true,
      createdAt: true,
      items: {
        select: { productName: true, sku: true, unitPricePoisha: true, quantity: true },
      },
    },
  });
  return orders.map((o) => ({
    id: o.id,
    orderNo: o.orderNo,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    subtotalPoisha: o.subtotalPoisha,
    discountPoisha: o.discountPoisha,
    shippingPoisha: o.shippingPoisha,
    totalPoisha: o.totalPoisha,
    customerPhoneMasked: maskPhone(o.customerPhone),
    itemCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
    items: o.items,
    createdAt: o.createdAt.toISOString(),
  }));
}
