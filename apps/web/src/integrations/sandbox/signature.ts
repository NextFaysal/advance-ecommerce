// Webhook signature verification — Agent 9.
// Pure HMAC-SHA256, timing-safe comparison. The secret is NEVER hardcoded
// here: the caller supplies it from Admin Settings (encrypted, server-side
// only via getIntegrationConfigWithSecrets) or, for sandbox testing only,
// from the local env var SANDBOX_WEBHOOK_TEST_SECRET. If no secret is
// available, verification FAILS — an unverified webhook is never applied.
// A real provider secret must never be put in code, logs, or a test fixture.
import { createHmac, timingSafeEqual } from "node:crypto";

export interface SignatureCheck {
  verified: boolean;
  reason: string | null;
}

/** Expected format: hex HMAC-SHA256 of the raw body, optionally "sha256=<hex>". */
export function verifyHmacSignature(
  secret: string | null | undefined,
  rawBody: string,
  signature: string | null | undefined,
  timestamp?: string,
): SignatureCheck {
  if (!secret) return { verified: false, reason: "no_secret_configured" };
  if (!signature) return { verified: false, reason: "missing_signature" };
  if (timestamp !== undefined) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return { verified: false, reason: "invalid_timestamp" };
    // Timestamp is seconds in most providers; accept seconds or milliseconds.
    const tsMs = ts < 1e12 ? ts * 1000 : ts;
    if (Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
      return { verified: false, reason: "timestamp_out_of_window" };
    }
  }
  const clean = signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  let verified = false;
  try {
    const a = Buffer.from(clean, "hex");
    const b = Buffer.from(expected, "hex");
    verified = a.length === b.length && timingSafeEqual(a, b);
  } catch {
    verified = false;
  }
  return { verified, reason: verified ? null : "signature_mismatch" };
}
