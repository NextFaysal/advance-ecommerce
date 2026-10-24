// SHA-256 hashing for CAPI user_data — server-side only (node:crypto).
// Meta/TikTok require phone as digits-only country+number (BD: 8801XXXXXXXXX)
// hashed with SHA-256, and email trimmed + lowercased before hashing.
// Plain values are never returned, stored, or logged by these helpers.
import { createHash } from "node:crypto";
import { normalizeBdPhone } from "@advance-ecommerce/validators";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** BD phone -> normalized (+8801...) -> digits only (8801...) -> SHA-256. */
export function hashPhoneForCapi(phone: string): string | null {
  const normalized = normalizeBdPhone(phone);
  if (!normalized) return null;
  return sha256Hex(normalized.replace(/\D/g, ""));
}

/** Email -> trim + lowercase -> SHA-256. Null when the input is not an email. */
export function hashEmailForCapi(email: string): string | null {
  const cleaned = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return null;
  return sha256Hex(cleaned);
}

/** External id -> SHA-256 (already an opaque id; hashed per platform rules). */
export function hashExternalId(externalId: string): string {
  return sha256Hex(externalId.trim());
}
