/**
 * POST /api/v1/public/account/api-tokens/[id]/revoke — revoke one
 * of the customer's own API tokens. Revocation bites on the very
 * next request (validation reads the row directly; there is no
 * token cache).
 *
 * Cookie-session ONLY (requireCustomerSession), like the rest of
 * token management — a bearer token cannot revoke tokens either, so
 * a leaked token cannot kill the customer's other devices' tokens
 * or the recovery path itself.
 *
 * Responses: 200 with the updated hash-free view; 404 when the id is
 * unknown OR belongs to another customer (existence is never leaked
 * across customers); 409 when the token is already revoked (no
 * silent no-op success — the bd-devices precedent).
 */
import { NextResponse } from "next/server";
import { errorResponse, requireCustomerSession, unauthorized } from "@/customer-auth/http";
import { revokeCustomerApiToken } from "@/customer-auth/api-tokens";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const customer = await requireCustomerSession();
  if (customer === null) return unauthorized();
  const outcome = await revokeCustomerApiToken(customer.id, params.id);
  if (outcome.result === "not_found") {
    return errorResponse("NOT_FOUND", "টোকেনটি পাওয়া যায়নি।", 404);
  }
  if (outcome.result === "already_revoked") {
    return errorResponse("ALREADY_REVOKED", "টোকেনটি আগেই বাতিল করা হয়েছে।", 409);
  }
  return NextResponse.json({ data: { apiToken: outcome.view }, meta: { db: "PRISMA" } });
}
