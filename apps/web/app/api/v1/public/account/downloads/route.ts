/**
 * GET /api/v1/public/account/downloads — the signed-in customer's
 * digital downloads (doc 18, batch F3): every DownloadGrant on their
 * orders with file/product names, expiry, downloads left and a
 * computed status (active / expired / exhausted / revoked), plus
 * whether a re-issue request is already pending. Grant tokens are
 * hash-only and never appear here — downloading goes through the
 * session-authorized access endpoint below, not a token.
 */
import { NextResponse } from "next/server";
import { methodNotAllowed, requireCustomer, unauthorized } from "@/customer-auth/http";
import { listCustomerDownloads } from "@/catalog/download-reissue";

export async function GET() {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();
  const downloads = await listCustomerDownloads(customer.id);
  return NextResponse.json({ data: { downloads }, meta: { db: "PRISMA" } });
}

export function POST() {
  return methodNotAllowed();
}
