/**
 * POST /api/v1/public/account/downloads/[grantId]/access — the
 * session-authorized download (doc 18, batch F3).
 *
 * The signed-in OWNER of the grant's order downloads without the
 * bearer token: grant tokens are hash-only and unrecoverable by
 * design, so the account is the recoverable path. The service
 * enforces the SAME rules as token redemption (module flag,
 * revocation, expiry, max downloads; storage resolved BEFORE the
 * use is consumed) and answers:
 *   302 → short-lived presigned GET URL for the file
 *   404 NOT_FOUND              — unknown grant OR another customer's
 *   410 EXPIRED                — past the grant's 7-day expiry
 *   403 EXHAUSTED / REVOKED / FEATURE_LOCKED
 *   503 STORAGE_NOT_CONFIGURED — storage missing (use NOT consumed)
 */
import { NextResponse } from "next/server";
import { errorResponse, methodNotAllowed, requireCustomer, unauthorized } from "@/customer-auth/http";
import { accessDownloadGrantById } from "@/catalog/product-types";

const STATUS_BY_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  EXPIRED: 410,
  EXHAUSTED: 403,
  REVOKED: 403,
  FEATURE_LOCKED: 403,
  STORAGE_NOT_CONFIGURED: 503,
};

export async function POST(_req: Request, { params }: { params: { grantId: string } }) {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();
  const grantId = (params.grantId ?? "").trim();
  if (grantId === "") return errorResponse("NOT_FOUND", "ডাউনলোডটি পাওয়া যায়নি।", 404);
  const result = await accessDownloadGrantById(grantId, customer.id);
  if (!result.ok) {
    return errorResponse(result.code, result.message, STATUS_BY_CODE[result.code] ?? 400);
  }
  return NextResponse.redirect(result.url, 302);
}

export function GET() {
  return methodNotAllowed();
}
