/**
 * GET /api/v1/public/account/orders?page=1&pageSize=10 — the logged-in
 * customer's own orders, newest first, paginated. Because orders link
 * to the Customer row by id, this includes orders placed as a GUEST
 * with the same phone before registration. Per-order phone is masked,
 * as on the public track route.
 */
import { NextResponse } from "next/server";
import { listCustomerOrders } from "@/customer-auth/auth";
import { methodNotAllowed, requireCustomer, unauthorized } from "@/customer-auth/http";

export async function GET(req: Request) {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();

  const url = new URL(req.url);
  const pageRaw = Number(url.searchParams.get("page") ?? "1");
  const pageSizeRaw = Number(url.searchParams.get("pageSize") ?? "10");
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const pageSize =
    Number.isFinite(pageSizeRaw) && pageSizeRaw >= 1 ? Math.min(Math.floor(pageSizeRaw), 50) : 10;

  const { orders, total } = await listCustomerOrders(customer.id, page, pageSize);
  return NextResponse.json({
    data: { orders },
    meta: {
      db: "PRISMA",
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    },
  });
}

export function POST() {
  return methodNotAllowed();
}
