// Webhook processing contract — Agent 9.
// Every webhook, payment or courier, goes through exactly these steps:
//  1. Read the RAW body (routes must call req.text(), never req.json() first,
//     because the signature is computed over the raw bytes).
//  2. Verify the HMAC signature (signature.ts). Unverified => log, reject,
//     NEVER apply. No secret is available in sandbox unless it was set in
//     Settings (encrypted) or, for local sandbox tests only, in the env var
//     SANDBOX_WEBHOOK_TEST_SECRET. There is no hardcoded test secret.
//  3. Idempotency: the provider's idempotency key (header or body field)
//     is checked against the store. A replay returns the FIRST result with
//     duplicate:true and does not apply a second time — a duplicate webhook
//     must never double-charge, double-refund, or double-transition.
//  4. Log every attempt (verified or not, applied or not) with a reason
//     only — never the signature, secret, or full raw body.
//  5. Apply the change through the relevant state machine only.
import { verifyHmacSignature } from "./signature";
import { logWebhook, sandboxStore } from "./store";

export interface ProcessWebhookInput {
  channel: "payment" | "courier";
  provider: string;
  rawBody: string;
  signature: string | null;
  timestamp?: string;
  idempotencyKey: string;
  /** Caller supplies this from Settings/env, server-side only. */
  secret: string | null;
  /** Apply the verified, non-duplicate event. Return a reason on failure. */
  apply: () => { applied: boolean; reason: string | null };
}

export interface ProcessWebhookResult {
  verified: boolean;
  duplicate: boolean;
  applied: boolean;
  reason: string | null;
  httpStatus: 200 | 401 | 409;
}

export function processWebhook(input: ProcessWebhookInput): ProcessWebhookResult {
  const storeKey = `${input.channel}:${input.provider}:${input.idempotencyKey}`;
  const signature = verifyHmacSignature(input.secret, input.rawBody, input.signature, input.timestamp);
  if (!signature.verified) {
    logWebhook({
      channel: input.channel,
      provider: input.provider,
      idempotencyKey: input.idempotencyKey,
      verified: false,
      applied: false,
      duplicate: false,
      reason: signature.reason,
    });
    return { verified: false, duplicate: false, applied: false, reason: signature.reason, httpStatus: 401 };
  }
  const previous = sandboxStore.webhookResults.get(storeKey);
  if (previous !== undefined) {
    logWebhook({
      channel: input.channel,
      provider: input.provider,
      idempotencyKey: input.idempotencyKey,
      verified: true,
      applied: false,
      duplicate: true,
      reason: "duplicate_idempotency_key",
    });
    return { verified: true, duplicate: true, applied: previous.applied, reason: "duplicate", httpStatus: 200 };
  }
  const outcome = input.apply();
  sandboxStore.webhookResults.set(storeKey, { applied: outcome.applied, duplicate: false });
  logWebhook({
    channel: input.channel,
    provider: input.provider,
    idempotencyKey: input.idempotencyKey,
    verified: true,
    applied: outcome.applied,
    duplicate: false,
    reason: outcome.reason,
  });
  return {
    verified: true,
    duplicate: false,
    applied: outcome.applied,
    reason: outcome.reason,
    httpStatus: outcome.applied ? 200 : 409,
  };
}

/** Header/field names accepted by the sandbox webhook routes (documented contract). */
export const WEBHOOK_HEADERS = {
  signature: "x-webhook-signature",
  timestamp: "x-webhook-timestamp",
  idempotencyKey: "x-idempotency-key",
} as const;
