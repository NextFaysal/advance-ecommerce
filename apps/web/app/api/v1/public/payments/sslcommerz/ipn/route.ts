/**
 * SSLCommerz IPN listener — ADV-4 (doc 22).
 *
 * POST /api/v1/public/payments/sslcommerz/ipn
 *
 * The server-to-server channel: SSLCommerz POSTs the transaction
 * result here independently of the customer's browser, so this is
 * the confirmation that survives a closed tab. Like the browser
 * callback, the body is never trusted on its own — the val_id goes
 * through the gateway's verify() (validation API, amount + tran_id
 * checked against the persisted attempt) before anything is marked.
 *
 * Response contract: 200 with { applied } for every DEFINITIVE
 * outcome (confirmed, already-confirmed, rejected validation,
 * unknown attempt) so the gateway stops retrying; 500 only for
 * unexpected/transient failures (e.g. the database is down), where a
 * gateway retry is exactly what we want.
 */
import { NextResponse } from "next/server";
import { buildConfiguredPaymentGatewayFromSettings } from "@/payments/live-gateways";
import { prismaLivePaymentStore } from "@/payments/live-store";
import { SslCommerzError } from "@/integrations/sslcommerz";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const text = await req.text().catch(() => "");
  const params = new URLSearchParams(text);
  const tranId = params.get("tran_id");
  const valId = params.get("val_id");
  if (!tranId || !valId) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "IPN requires tran_id and val_id." } },
      { status: 400 },
    );
  }
  try {
    const attempt = await prismaLivePaymentStore.findAttemptById(tranId);
    if (!attempt || attempt.method !== "sslcommerz") {
      return NextResponse.json({ data: { applied: false, reason: "attempt_not_found" } });
    }
    if (
      attempt.status === "PAID" ||
      attempt.status === "PARTIALLY_REFUNDED" ||
      attempt.status === "REFUNDED"
    ) {
      return NextResponse.json({ data: { applied: true, duplicate: true, status: attempt.status } });
    }
    const gateway = await buildConfiguredPaymentGatewayFromSettings("sslcommerz");
    if (!gateway) {
      return NextResponse.json({ data: { applied: false, reason: "gateway_not_configured" } });
    }
    const verified = await gateway.verify({
      paymentAttemptId: attempt.attemptId,
      gatewayTransactionId: valId,
      idempotencyKey: `ssl-ipn:${attempt.attemptId}:${valId}`,
    });
    return NextResponse.json({ data: { applied: true, status: verified.status } });
  } catch (error) {
    if (error instanceof SslCommerzError) {
      // Definitive verdicts (validation rejected / amount / tran
      // mismatch): acknowledge so retries stop; the code carries why.
      return NextResponse.json({ data: { applied: false, reason: error.code } });
    }
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "IPN processing failed — retry expected." } },
      { status: 500 },
    );
  }
}
