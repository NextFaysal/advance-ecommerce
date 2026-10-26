/**
 * Upay IPN listener — ADV-4 remainder (doc 22).
 *
 * POST /api/v1/public/payments/upay/ipn
 *
 * The server-to-server channel, mirroring the SSLCommerz IPN
 * contract: the body is never trusted on its own — the invoice id
 * goes through the gateway's verify() (server-side query-by-invoice,
 * status + invoice + amount checked against the persisted attempt)
 * before anything is marked.
 *
 * Response contract: 200 with { applied } for every DEFINITIVE
 * outcome (confirmed, already-confirmed, rejected verification,
 * unknown attempt) so the gateway stops retrying; 500 only for
 * unexpected/transient failures, where a gateway retry is exactly
 * what we want.
 *
 * ⚠️ Parameter spellings are UNVERIFIED against Upay's official
 * merchant API document — see src/integrations/upay/provider-http.ts.
 */
import { NextResponse } from "next/server";
import { buildConfiguredPaymentGatewayFromSettings } from "@/payments/live-gateways";
import { prismaLivePaymentStore } from "@/payments/live-store";
import { UpayError } from "@/integrations/upay";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const text = await req.text().catch(() => "");
  const params = new URLSearchParams(text);
  const invoiceId = params.get("invoice_id") ?? params.get("tran_id") ?? params.get("invoiceId");
  if (!invoiceId) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "IPN requires an invoice_id." } },
      { status: 400 },
    );
  }
  try {
    const attempt = await prismaLivePaymentStore.findAttemptById(invoiceId);
    if (!attempt || attempt.method !== "upay") {
      return NextResponse.json({ data: { applied: false, reason: "attempt_not_found" } });
    }
    if (
      attempt.status === "PAID" ||
      attempt.status === "PARTIALLY_REFUNDED" ||
      attempt.status === "REFUNDED"
    ) {
      return NextResponse.json({ data: { applied: true, duplicate: true, status: attempt.status } });
    }
    const gateway = await buildConfiguredPaymentGatewayFromSettings("upay");
    if (!gateway) {
      return NextResponse.json({ data: { applied: false, reason: "gateway_not_configured" } });
    }
    const verified = await gateway.verify({
      paymentAttemptId: attempt.attemptId,
      gatewayTransactionId: params.get("trx_id") ?? attempt.attemptId,
      idempotencyKey: `upay-ipn:${attempt.attemptId}`,
    });
    return NextResponse.json({ data: { applied: true, status: verified.status } });
  } catch (error) {
    if (error instanceof UpayError) {
      // Definitive verdicts (verification rejected / amount /
      // invoice mismatch): acknowledge so retries stop; the code
      // carries why. UNRECOGNIZED_RESPONSE stays unapplied — a later
      // IPN can still resolve the attempt once the gateway record
      // settles.
      return NextResponse.json({ data: { applied: false, reason: error.code } });
    }
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "IPN processing failed — retry expected." } },
      { status: 500 },
    );
  }
}
