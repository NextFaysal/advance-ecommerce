/**
 * GET /api/v1/public/account/me — the logged-in customer's public
 * profile (id, name, phone + masked phone, email, member-since).
 * 401 when there is no valid customer_session.
 */
import { NextResponse } from "next/server";
import { methodNotAllowed, requireCustomer, unauthorized } from "@/customer-auth/http";

export async function GET() {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();
  return NextResponse.json({ data: { customer }, meta: { db: "PRISMA" } });
}

export function POST() {
  return methodNotAllowed();
}
