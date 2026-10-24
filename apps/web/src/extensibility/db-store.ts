/**
 * Prisma-backed extensibility stores — DB-backed since 2026-10-24.
 *
 * Server-only (imports the Prisma client): server code imports this
 * file directly; src/extensibility/store.ts stays Prisma-free.
 *
 * API-KEY DISCIPLINE (the module's core invariant, preserved): only
 * the SHA-256 hash of a key is ever written — the plain key exists
 * solely in createApiKey()'s one-time return value. Nothing in this
 * file logs key material, and findByHash takes an already-hashed
 * value so callers never hand a plain key to the store.
 *
 * SCHEMA DRIFT (reported, worked around — schema.prisma NOT changed):
 *  - ApiKey has no keyPrefix / pluginId columns: both ride inside the
 *    scopesJson Json bag as { scopes, keyPrefix, pluginId } (the same
 *    trick AutomationRunLog uses for detailJson). Reads tolerate a
 *    plain-array scopesJson (scopes only, prefix "", pluginId null).
 *  - WebhookSubscription rows are ONE PER EVENT (event is a scalar),
 *    where the TS contract has one subscription with an events[] list:
 *    writes fan out to one row per event and reads group rows back by
 *    (targetUrl, hasSecret, isActive). Two distinct subscriptions
 *    sharing all three would merge on read — accepted + documented.
 *    `description` has no column and does not persist. A grouped
 *    subscription's id is its earliest row's id; setEnabled / remove
 *    resolve the group through any of its row ids.
 */
import { prisma } from "@advance-ecommerce/db";
import { hashApiKey, verifyApiKey } from "./api-keys";
import type { ApiKeyStore, WebhookSubscriptionStore } from "./store";
import type { ApiKeyRecord, DomainEvent, WebhookSubscription } from "./types";

type ApiKeyRow = Awaited<ReturnType<typeof prisma.apiKey.findMany>>[number];
type WebhookRow = Awaited<ReturnType<typeof prisma.webhookSubscription.findMany>>[number];

interface ScopesBag {
  scopes: string[];
  keyPrefix: string;
  pluginId: string | null;
}

function readScopesBag(json: unknown): ScopesBag {
  if (Array.isArray(json)) {
    return { scopes: json.filter((s): s is string => typeof s === "string"), keyPrefix: "", pluginId: null };
  }
  if (typeof json === "object" && json !== null) {
    const bag = json as Partial<ScopesBag>;
    return {
      scopes: Array.isArray(bag.scopes) ? bag.scopes.filter((s): s is string => typeof s === "string") : [],
      keyPrefix: typeof bag.keyPrefix === "string" ? bag.keyPrefix : "",
      pluginId: typeof bag.pluginId === "string" ? bag.pluginId : null,
    };
  }
  return { scopes: [], keyPrefix: "", pluginId: null };
}

function rowToApiKey(row: ApiKeyRow): ApiKeyRecord {
  const bag = readScopesBag(row.scopesJson);
  return {
    id: row.id,
    name: row.name,
    keyPrefix: bag.keyPrefix,
    keyHash: row.keyHash,
    scopes: bag.scopes,
    pluginId: bag.pluginId,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    isRevoked: row.revokedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

export class PrismaApiKeyStore implements ApiKeyStore {
  async create(record: ApiKeyRecord): Promise<ApiKeyRecord> {
    const row = await prisma.apiKey.create({
      data: {
        ...(record.id ? { id: record.id } : {}),
        name: record.name,
        keyHash: record.keyHash, // hash ONLY — the plain key never reaches this layer
        scopesJson: {
          scopes: record.scopes,
          keyPrefix: record.keyPrefix,
          pluginId: record.pluginId,
        } satisfies ScopesBag,
        expiresAt: record.expiresAt ? new Date(record.expiresAt) : null,
        revokedAt: record.isRevoked ? new Date(record.createdAt) : null,
        lastUsedAt: record.lastUsedAt ? new Date(record.lastUsedAt) : null,
      },
    });
    return rowToApiKey(row);
  }

  async list(): Promise<ApiKeyRecord[]> {
    const rows = await prisma.apiKey.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(rowToApiKey);
  }

  async findByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    const row = await prisma.apiKey.findUnique({ where: { keyHash } });
    return row ? rowToApiKey(row) : null;
  }

  async revoke(id: string): Promise<boolean> {
    const result = await prisma.apiKey.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count > 0;
  }

  async touchLastUsed(id: string, at: Date): Promise<void> {
    await prisma.apiKey.update({ where: { id }, data: { lastUsedAt: at } });
  }
}

/** Shared Prisma instance for API-key persistence. */
export const apiKeyStore: ApiKeyStore = new PrismaApiKeyStore();

/**
 * Authenticate a presented plain key against the DB: hash it, find the
 * record, run the existing constant-time verify (revocation + expiry
 * included), and stamp lastUsedAt on success. Returns the record or
 * null. The plain key is used only to compute the hash in-process.
 */
export async function verifyPresentedApiKey(
  presentedKey: string,
  now: Date,
): Promise<ApiKeyRecord | null> {
  const record = await apiKeyStore.findByHash(hashApiKey(presentedKey));
  if (!record) return null;
  if (!verifyApiKey(record, presentedKey, now)) return null;
  await apiKeyStore.touchLastUsed(record.id, now);
  return record;
}

/* ------------------------------------------------------------------ */
/* Webhook subscriptions                                                */
/* ------------------------------------------------------------------ */

function groupRows(rows: WebhookRow[]): WebhookSubscription[] {
  const groups = new Map<string, { first: WebhookRow; events: string[] }>();
  for (const row of rows) {
    const key = `${row.targetUrl}|${row.hasSecret}|${row.isActive}`;
    const group = groups.get(key);
    if (group) group.events.push(row.event);
    else groups.set(key, { first: row, events: [row.event] });
  }
  return [...groups.values()].map(({ first, events }) => ({
    id: first.id,
    url: first.targetUrl,
    events: events as DomainEvent[],
    isEnabled: first.isActive,
    hasSecret: first.hasSecret,
  }));
}

export class PrismaWebhookSubscriptionStore implements WebhookSubscriptionStore {
  async create(sub: WebhookSubscription): Promise<WebhookSubscription> {
    let firstId = sub.id;
    for (const [index, event] of sub.events.entries()) {
      const row = await prisma.webhookSubscription.create({
        data: {
          event,
          targetUrl: sub.url,
          hasSecret: sub.hasSecret,
          isActive: sub.isEnabled,
        },
      });
      if (index === 0) firstId = row.id;
    }
    return { ...sub, id: firstId };
  }

  async list(): Promise<WebhookSubscription[]> {
    const rows = await prisma.webhookSubscription.findMany({ orderBy: { createdAt: "asc" } });
    return groupRows(rows);
  }

  async listForEvent(event: string): Promise<WebhookSubscription[]> {
    const rows = await prisma.webhookSubscription.findMany({
      where: { event, isActive: true },
      orderBy: { createdAt: "asc" },
    });
    return groupRows(rows);
  }

  /** Resolve the (targetUrl, hasSecret) group a row id belongs to. */
  private async groupWhere(id: string): Promise<{ targetUrl: string; hasSecret: boolean } | null> {
    const row = await prisma.webhookSubscription.findUnique({ where: { id } });
    return row ? { targetUrl: row.targetUrl, hasSecret: row.hasSecret } : null;
  }

  async setEnabled(id: string, isEnabled: boolean): Promise<boolean> {
    const group = await this.groupWhere(id);
    if (!group) return false;
    const result = await prisma.webhookSubscription.updateMany({
      where: group,
      data: { isActive: isEnabled },
    });
    return result.count > 0;
  }

  async remove(id: string): Promise<boolean> {
    const group = await this.groupWhere(id);
    if (!group) return false;
    const result = await prisma.webhookSubscription.deleteMany({ where: group });
    return result.count > 0;
  }
}

/** Shared Prisma instance for webhook-subscription persistence. */
export const webhookSubscriptionStore: WebhookSubscriptionStore = new PrismaWebhookSubscriptionStore();
