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
 *  - customers: phone only as maskPhone() output; no credential or
 *    social-binding fields (passwordHash / googleId / facebookId are
 *    never selected).
 *
 * Merchant custom-field values (ADV-26, wave 53) ride additively on
 * all three serialisers as `customFields` — the key appears ONLY on
 * rows that actually have values stored.
 */
import { NextResponse } from "next/server";
import { prisma } from "@advance-ecommerce/db";
import { maskPhone } from "@advance-ecommerce/validators";
import { checkRateLimit } from "../lib/rate-limit";
import { authenticatePartnerKey, type AuthenticatedPartnerKey, type PartnerScope } from "./api-keys";
import { getCustomFieldValuesForIds } from "../extensibility/custom-fields-store";
import { addQty, qtyToString } from "../lib/quantity";

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
  const customFieldsById = await getCustomFieldValuesForIds(
    "product",
    products.map((p) => p.id),
  );
  return products.map((p) => {
    const customFields = customFieldsById.get(p.id);
    return {
      ...p,
      updatedAt: p.updatedAt.toISOString(),
      ...(customFields ? { customFields } : {}),
    };
  });
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
  const customFieldsById = await getCustomFieldValuesForIds(
    "order",
    orders.map((o) => o.id),
  );
  return orders.map((o) => {
    const customFields = customFieldsById.get(o.id);
    return {
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
      // Wave 59: quantities are Decimal(12,3) now — itemCount sums in
      // milli-exact math and each line's quantity serialises as a
      // STRING ("1.5"), never a float, per the wire rule.
      itemCount: o.items.reduce((sum, i) => addQty(sum, i.quantity), 0),
      items: o.items.map((i) => ({ ...i, quantity: qtyToString(i.quantity) })),
      createdAt: o.createdAt.toISOString(),
      ...(customFields ? { customFields } : {}),
    };
  });
}

export async function listPartnerCustomers(limit: number) {
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      createdAt: true,
      // passwordHash / googleId / facebookId deliberately NOT
      // selected — credentials and social bindings never leave the DB.
    },
  });
  // Lifetime stats from the orders table itself (Order.customerId is
  // a required FK — every order, guest or registered, belongs to a
  // Customer row). One groupBy for the whole page, not per-row
  // queries. Counts every recorded order regardless of status.
  const stats = customers.length
    ? await prisma.order.groupBy({
        by: ["customerId"],
        where: { customerId: { in: customers.map((c) => c.id) } },
        _count: { _all: true },
        _sum: { totalPoisha: true },
      })
    : [];
  const statsById = new Map(
    stats.map((s) => [s.customerId, { count: s._count._all, totalPoisha: s._sum.totalPoisha ?? 0 }]),
  );
  const customFieldsById = await getCustomFieldValuesForIds(
    "customer",
    customers.map((c) => c.id),
  );
  return customers.map((c) => {
    const customFields = customFieldsById.get(c.id);
    const lifetime = statsById.get(c.id) ?? { count: 0, totalPoisha: 0 };
    return {
      id: c.id,
      name: c.name,
      phoneMasked: maskPhone(c.phone),
      email: c.email,
      createdAt: c.createdAt.toISOString(),
      lifetimeOrderCount: lifetime.count,
      lifetimeTotalPoisha: lifetime.totalPoisha,
      ...(customFields ? { customFields } : {}),
    };
  });
}
