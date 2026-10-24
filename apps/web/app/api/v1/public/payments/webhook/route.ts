// Public payment webhook (sandbox) — Agent 9.
// POST /api/v1/public/payments/webhook?provider=bkash|nagad|sslcommerz
// Contract (see sandbox/README.md and sandbox/webhook.ts):
//  - The RAW body is read with req.text() and the HMAC signature in the
//    x-webhook-signature header is verified BEFORE anything is applied.
//    Unverified webhooks are logged and rejected with 401, never applied.
//  - The secret comes server-side from Admin Settings (encrypted) if a
//    row exists, otherwise from the local env SANDBOX_WEBHOOK_TEST_SECRET
//    (sandbox testing only). There is no hardcoded secret; with neither
//    configured, every webhook is rejected — that is intentional.
//  - idempotencyKey (header x-idempotency-key or body field) makes a
//    replay return the first result with duplicate:true — a duplicate
//    webhook never applies twice.
//  - Body: { paymentAttemptId, gatewayTransactionId, rawStatus, idempotencyKey? }
//    rawStatus is mapped per provider in sandbox/status-mapping.ts.
// Real integration must additionally: persist to a webhook_logs DB table,
// verify with the provider's real signature scheme, and update the
// payments DB row + order payment status in one transaction.
import { NextResponse } from "next/server";
import { z } from "zod";
import { processWebhook, WEBHOOK_HEADERS } from "@/integrations/sandbox/webhook";
import { mapPaymentRawStatus } from "@/integrations/sandbox/status-mapping";
import { sandboxStore } from "@/integrations/sandbox/store";
import { SANDBOX_PAYMENT_METHODS } from "@/integrations/sandbox/payment-gateway";
import { getSetting } from "@/lib/settings";

const bodySchema = z.object({
  paymentAttemptId: z.string().min(1),
  gatewayTransactionId: z.string().min(1),
  rawStatus: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
});

async function webhookSecret(provider: string): Promise<string | null> {
  try {
    const fromSettings = await getSetting(`payment.${provider}.webhook_secret`);
    if (fromSettings) return fromSettings;
  } catch {
    // Settings/DB not available in a pure sandbox run — fall through to env.
  }
  return process.env.SANDBOX_WEBHOOK_TEST_SECRET ?? null;
}

export async function POST(req: Request) {
  const provider = new URL(req.url).searchParams.get("provider") ?? "";
  if (!(SANDBOX_PAYMENT_METHODS as readonly string[]).includes(provider)) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Unknown or non-sandbox payment provider." } },
      { status: 400 },
    );
  }
  const rawBody = await req.text();
  let body: unknown = {};
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Webhook body must be JSON." } },
      { status: 400 },
    );
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid webhook body." } },
      { status: 400 },
    );
  }
  const idempotencyKey =
    req.headers.get(WEBHOOK_HEADERS.idempotencyKey) ?? parsed.data.idempotencyKey ?? null;
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "An idempotency key is required." } },
      { status: 400 },
    );
  }
  const secret = await webhookSecret(provider);
  const result = processWebhook({
    channel: "payment",
    provider,
    rawBody,
    signature: req.headers.get(WEBHOOK_HEADERS.signature),
    timestamp: req.headers.get(WEBHOOK_HEADERS.timestamp) ?? undefined,
    idempotencyKey,
    secret,
    apply: () => {
      const attempt = sandboxStore.payments.get(parsed.data.paymentAttemptId);
      if (!attempt || attempt.method !== provider) {
        return { applied: false, reason: "attempt_not_found" };
      }
      if (attempt.gatewayTransactionId !== parsed.data.gatewayTransactionId) {
        return { applied: false, reason: "transaction_mismatch" };
      }
      const status = mapPaymentRawStatus(provider, parsed.data.rawStatus);
      if (status === null) return { applied: false, reason: "unknown_raw_status" };
      attempt.status = status;
      if (status === "PAID") attempt.paidPoisha = attempt.amountPoisha;
      if (status === "FAILED") attempt.paidPoisha = 0;
      return { applied: true, reason: null };
    },
  });
  return NextResponse.json(
    {
      data: {
        verified: result.verified,
        duplicate: result.duplicate,
        applied: result.applied,
        reason: result.reason,
      },
      meta: { sandbox: true },
    },
    { status: result.httpStatus },
  );
}
