/**
 * Partner API keys — ADV-26 (doc 22).
 *
 * Keys live on the existing ApiKey table (shared with the plugin /
 * extensibility store). Discipline, identical to gift cards:
 *  - the plaintext key (`ae_live_<32 chars>`) is returned EXACTLY
 *    ONCE at creation; at rest only its SHA-256 hash exists;
 *  - keyPrefix (first 12 chars) is the only displayable fragment;
 *  - scopes are validated against a fixed catalogue — a key can
 *    never carry a scope the platform doesn't know;
 *  - creation writes BOTH the new columns (keyPrefix, scopes) and
 *    the legacy scopesJson bag so the extensibility store's reads
 *    stay consistent with the partner surface.
 *
 * Authentication: hash the presented key, look up by unique hash,
 * refuse revoked keys, stamp lastUsedAt on success.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import { hashApiKey } from "../extensibility/api-keys";

export const PARTNER_SCOPES = ["products:read", "orders:read", "customers:read"] as const;
export type PartnerScope = (typeof PARTNER_SCOPES)[number];

export function isPartnerScope(value: string): value is PartnerScope {
  return (PARTNER_SCOPES as readonly string[]).includes(value);
}

export interface PartnerApiKeyView {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdById: string | null;
  createdAt: string;
}

export interface CreatedPartnerApiKey extends PartnerApiKeyView {
  /** Plaintext key — returned ONCE, never stored in clear. */
  key: string;
}

type ApiKeyRow = Awaited<ReturnType<typeof prisma.apiKey.findMany>>[number];

function scopesOf(row: ApiKeyRow): string[] {
  // Prefer the first-class column; fall back to the legacy bag for
  // rows created by the extensibility store before ADV-26.
  if (Array.isArray(row.scopes) && row.scopes.length > 0) return row.scopes;
  const bag = row.scopesJson as { scopes?: unknown } | null;
  if (bag && Array.isArray(bag.scopes)) return bag.scopes.filter((s): s is string => typeof s === "string");
  return [];
}

function toView(row: ApiKeyRow): PartnerApiKeyView {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix || "",
    scopes: scopesOf(row),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
  };
}

export function generatePartnerKey(): { key: string; prefix: string } {
  const key = `ae_live_${randomBytes(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, 12) };
}

export async function createPartnerApiKey(input: {
  name: string;
  scopes: string[];
  createdById: string;
}): Promise<CreatedPartnerApiKey> {
  const scopes: PartnerScope[] = [];
  for (const s of input.scopes) {
    if (!isPartnerScope(s)) throw new Error(`UNKNOWN_SCOPE:${s}`);
    if (!scopes.includes(s)) scopes.push(s);
  }
  if (scopes.length === 0) throw new Error("NO_SCOPES");
  const { key, prefix } = generatePartnerKey();
  const row = await prisma.apiKey.create({
    data: {
      name: input.name,
      keyHash: hashApiKey(key), // hash ONLY — the plain key never persists
      keyPrefix: prefix,
      scopes,
      scopesJson: { scopes, keyPrefix: prefix, pluginId: null },
      createdById: input.createdById,
    },
  });
  return { ...toView(row), key };
}

export async function listPartnerApiKeys(): Promise<PartnerApiKeyView[]> {
  const rows = await prisma.apiKey.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(toView);
}

export async function revokePartnerApiKey(id: string): Promise<boolean> {
  const result = await prisma.apiKey.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

export interface AuthenticatedPartnerKey {
  id: string;
  name: string;
  scopes: string[];
}

/**
 * Authenticate a presented Bearer key. Returns null for unknown,
 * malformed or revoked keys (callers answer 401 uniformly — no
 * oracle about which check failed). Stamps lastUsedAt on success.
 */
export async function authenticatePartnerKey(
  presented: string,
): Promise<AuthenticatedPartnerKey | null> {
  if (!presented.startsWith("ae_live_") || presented.length < 20) return null;
  const row = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(presented) } });
  if (!row) return null;
  if (row.revokedAt !== null) return null;
  if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) return null;
  await prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  return { id: row.id, name: row.name, scopes: scopesOf(row) };
}
