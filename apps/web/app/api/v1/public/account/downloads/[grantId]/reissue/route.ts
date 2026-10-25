/**
 * POST /api/v1/public/account/downloads/[grantId]/reissue — ask
 * staff for a replacement download grant (doc 18, batch F3).
 *
 * For grants that are expired / exhausted, or whose one-time link
 * the customer lost. Creates a PENDING DownloadReissueRequest;
 * staff decide in /admin/downloads (approval mints a NEW grant and
 * revokes this one). One open request per grant:
 *   404 NOT_FOUND       — unknown grant OR another customer's
 *   409 ALREADY_PENDING — a request is already waiting for staff
 */
import { NextResponse } from "next/server";
import { errorResponse, methodNotAllowed, requireCustomer, unauthorized } from "@/customer-auth/http";
import { createReissueRequest } from "@/catalog/download-reissue";

const ERROR_HTTP: Record<string, number> = {
  NOT_FOUND: 404,
  ALREADY_PENDING: 409,
};

export async function POST(req: Request, { params }: { params: { grantId: string } }) {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();
  const grantId = (params.grantId ?? "").trim();
  if (grantId === "") return errorResponse("NOT_FOUND", "ডাউনলোডটি পাওয়া যায়নি।", 404);
  const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason : undefined;
  const out = await createReissueRequest({ customerId: customer.id, grantId, reason });
  if (!out.ok) {
    return errorResponse(out.code, out.error, ERROR_HTTP[out.code] ?? 400);
  }
  return NextResponse.json({ data: out.value, meta: { db: "PRISMA" } }, { status: 201 });
}

export function GET() {
  return methodNotAllowed();
}
