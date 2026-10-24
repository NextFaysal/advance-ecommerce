/**
 * API keys — hash-only storage — Agent 17, Step 49 (A16).
 *
 * Server-only (node:crypto). The plain key is generated once, returned to
 * the caller once, and only its SHA-256 hash is kept — the same discipline
 * as payment-link tokens (Agent 11). Verification hashes the presented key
 * and compares with timingSafeEqual; a revoked or expired key never
 * verifies. Scopes are module.action permission strings, checked with
 * hasScope() — a key can never exceed the scopes it was issued with.
 *
 * Plain key format: `ak_live_<32 hex>` / `ak_test_<32 hex>`.
 * The stored keyPrefix is `ak_live_` + first 4 hex chars — enough to
 * identify a key in a list, useless for reconstructing it.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ApiKeyPublicView, ApiKeyRecord } from "./types";

export function hashApiKey(plainKey: string): string {
  return createHash("sha256").update(plainKey).digest("hex");
}

export interface CreatedApiKey {
  record: ApiKeyRecord;
  /** Returned ONCE. Never stored, never logged. */
  plainKey: string;
}

export interface CreateApiKeyInput {
  id: string;
  name: string;
  scopes: string[];
  pluginId: string | null;
  live: boolean;
  /** Days from now; null = no expiry. */
  expiresInDays: number | null;
  now: Date;
}

export function createApiKey(input: CreateApiKeyInput): CreatedApiKey {
  const mode = input.live ? "ak_live_" : "ak_test_";
  const secretPart = randomBytes(16).toString("hex"); // 32 hex chars
  const plainKey = `${mode}${secretPart}`;
  const expiresAt =
    input.expiresInDays === null
      ? null
      : new Date(input.now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  const record: ApiKeyRecord = {
    id: input.id,
    name: input.name,
    keyPrefix: `${mode}${secretPart.slice(0, 4)}`,
    keyHash: hashApiKey(plainKey),
    scopes: [...input.scopes],
    pluginId: input.pluginId,
    expiresAt,
    lastUsedAt: null,
    isRevoked: false,
    createdAt: input.now.toISOString(),
  };
  return { record, plainKey };
}

export function verifyApiKey(record: ApiKeyRecord, presentedKey: string, now: Date): boolean {
  if (record.isRevoked) return false;
  if (record.expiresAt !== null && new Date(record.expiresAt).getTime() <= now.getTime()) {
    return false;
  }
  const presented = Buffer.from(hashApiKey(presentedKey), "hex");
  const stored = Buffer.from(record.keyHash, "hex");
  if (presented.length !== stored.length) return false;
  return timingSafeEqual(presented, stored);
}

export function hasScope(record: ApiKeyRecord, requiredScope: string): boolean {
  return record.scopes.includes(requiredScope) || record.scopes.includes("*");
}

export function toApiKeyPublicView(record: ApiKeyRecord): ApiKeyPublicView {
  return {
    id: record.id,
    name: record.name,
    keyPrefix: record.keyPrefix,
    scopes: [...record.scopes],
    pluginId: record.pluginId,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt,
    isRevoked: record.isRevoked,
    createdAt: record.createdAt,
  };
}
