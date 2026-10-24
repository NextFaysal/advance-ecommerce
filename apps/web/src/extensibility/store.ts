// Extensibility stores — Agent 17 interfaces, DB-backed since 2026-10-24.
//
// Persistence lives behind these interfaces; the runtime stores are
// the Prisma implementations in ./db-store.ts (shared instances:
// `apiKeyStore`, `webhookSubscriptionStore`). The in-memory
// implementations stay for tests/fixtures. This file must NEVER
// import Prisma (client-bundle safety).
//
// NOT persisted anywhere, by design / by schema:
//  - Hook + adapter registries stay in-memory: they hold live handler
//    functions, which are process state, not data.
//  - Custom-field DEFINITIONS have no table in the merged schema —
//    they remain merchant configuration data validated by
//    custom-fields.ts; reported as schema drift by the DB-swap pass.
//  - Webhook DELIVERY logs have no table either: deliveries run
//    through the webhook-delivery queue (webhooks.ts contract); the
//    worker owns their persistence when it lands.
import type { ApiKeyRecord, WebhookSubscription } from "./types";

export interface ApiKeyStore {
  create(record: ApiKeyRecord): Promise<ApiKeyRecord>;
  list(): Promise<ApiKeyRecord[]>;
  findByHash(keyHash: string): Promise<ApiKeyRecord | null>;
  /** Sets revokedAt. Returns false when the key does not exist. */
  revoke(id: string): Promise<boolean>;
  touchLastUsed(id: string, at: Date): Promise<void>;
}

export interface WebhookSubscriptionStore {
  create(sub: WebhookSubscription): Promise<WebhookSubscription>;
  list(): Promise<WebhookSubscription[]>;
  /** Enabled subscriptions covering an event (feed for
   *  subscriptionsForEvent() in webhooks.ts). */
  listForEvent(event: string): Promise<WebhookSubscription[]>;
  setEnabled(id: string, isEnabled: boolean): Promise<boolean>;
  remove(id: string): Promise<boolean>;
}

/* ------------------------------------------------------------------ */
/* In-memory implementations (tests / fixtures)                         */
/* ------------------------------------------------------------------ */

export class InMemoryApiKeyStore implements ApiKeyStore {
  private records = new Map<string, ApiKeyRecord>();

  async create(record: ApiKeyRecord): Promise<ApiKeyRecord> {
    this.records.set(record.id, { ...record });
    return record;
  }
  async list(): Promise<ApiKeyRecord[]> { return [...this.records.values()].map((r) => ({ ...r })); }
  async findByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    return [...this.records.values()].find((r) => r.keyHash === keyHash) ?? null;
  }
  async revoke(id: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record) return false;
    record.isRevoked = true;
    return true;
  }
  async touchLastUsed(id: string, at: Date): Promise<void> {
    const record = this.records.get(id);
    if (record) record.lastUsedAt = at.toISOString();
  }
}

export class InMemoryWebhookSubscriptionStore implements WebhookSubscriptionStore {
  private subs = new Map<string, WebhookSubscription>();

  async create(sub: WebhookSubscription): Promise<WebhookSubscription> {
    this.subs.set(sub.id, { ...sub });
    return sub;
  }
  async list(): Promise<WebhookSubscription[]> { return [...this.subs.values()].map((s) => ({ ...s })); }
  async listForEvent(event: string): Promise<WebhookSubscription[]> {
    return [...this.subs.values()].filter(
      (s) => s.isEnabled && (s.events as string[]).includes(event),
    );
  }
  async setEnabled(id: string, isEnabled: boolean): Promise<boolean> {
    const sub = this.subs.get(id);
    if (!sub) return false;
    sub.isEnabled = isEnabled;
    return true;
  }
  async remove(id: string): Promise<boolean> { return this.subs.delete(id); }
}
