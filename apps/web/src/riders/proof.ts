// Delivery OTP proof helpers — Agent 18 (E3).
// The OTP itself is a short-lived secret shared with the customer (SMS /
// order page). We persist ONLY its SHA-256 hash on the delivery proof and
// compare in constant time — the same hash-only rule used for payment-link
// tokens (src/bd/payment-link.ts) and API keys (src/extensibility/api-keys.ts).
import { createHash, timingSafeEqual } from "node:crypto";

export function hashDeliveryOtp(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

/** Constant-time check of a plain code against a stored hash. */
export function verifyDeliveryOtp(code: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashDeliveryOtp(code), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}
