/**
 * Customer API tokens — management (the token-auth seam for the
 * public account API; see src/customer-auth/api-tokens.ts).
 *
 * GET  — the customer's own tokens, hash-free views, newest first.
 * POST — mint a token: body { "label": "আমার ফোন" } → 201 with the
 *        plaintext token in `data.token`. That response is the ONLY
 *        time the plaintext ever exists server-side; only its
 *        SHA-256 hash is stored.
 *
 * BOTH verbs are cookie-session ONLY (requireCustomerSession): a
 * bearer token must never mint more tokens — a leaked token could
 * otherwise extend itself and lock the customer out of recovery.
 * Cap: 10 ACTIVE tokens per customer (409 API_TOKEN_LIMIT beyond).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  errorResponse,
  methodNotAllowed,
  requireCustomerSession,
  unauthorized,
} from "@/customer-auth/http";
import {
  CustomerApiTokenLimitError,
  createCustomerApiToken,
  listCustomerApiTokens,
} from "@/customer-auth/api-tokens";

export async function GET() {
  const customer = await requireCustomerSession();
  if (customer === null) return unauthorized();
  const tokens = await listCustomerApiTokens(customer.id);
  return NextResponse.json({ data: { tokens }, meta: { db: "PRISMA" } });
}

const createSchema = z.object({
  label: z.string().trim().min(1, "টোকেনের একটি নাম দিন").max(60, "নাম সর্বোচ্চ ৬০ অক্ষরের হবে"),
});

export async function POST(req: Request) {
  const customer = await requireCustomerSession();
  if (customer === null) return unauthorized();
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return errorResponse(
      "INVALID_INPUT",
      "টোকেনের একটি নাম দিন (সর্বোচ্চ ৬০ অক্ষর)।",
      400,
      parsed.error.issues,
    );
  }
  try {
    const { view, token } = await createCustomerApiToken(customer.id, parsed.data.label);
    return NextResponse.json(
      { data: { apiToken: view, token }, meta: { db: "PRISMA" } },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof CustomerApiTokenLimitError) {
      return errorResponse(
        "API_TOKEN_LIMIT",
        "সর্বোচ্চ ১০টি সক্রিয় টোকেন রাখা যায় — নতুন তৈরি করতে আগে একটি বাতিল করুন।",
        409,
      );
    }
    throw err;
  }
}

export function DELETE() {
  return methodNotAllowed();
}
