/**
 * Extensibility types — Agent 17, Execution Plan Step 49 (A13–A16).
 *
 * Pure domain types + Zod schemas for the plugin/hook system. No DB, no
 * code execution: a "plugin" here is a DECLARATION (manifest + hook
 * subscriptions + adapter registrations). Runtime sandboxing of third-party
 * plugin code is a separate deployment concern — see docs/MODULES.md.
 * Money is integer poisha everywhere. API keys are hash-only by design:
 * the plain key exists once, at creation, and is never stored.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Domain events — the same event names the core publishes             */
/* (Master Prompt: order.created, order.status_changed,                */
/*  payment.succeeded, stock.low). Plugins subscribe to these; they    */
/*  never invent new core events.                                      */
/* ------------------------------------------------------------------ */

export const DOMAIN_EVENTS = [
  "order.created",
  "order.status_changed",
  "order.cancelled",
  "order.delivered",
  "order.returned",
  "payment.succeeded",
  "payment.failed",
  "payment.refunded",
  "stock.low",
  "stock.movement",
  "customer.registered",
  "checkout.abandoned",
  "shipment.status_changed",
] as const;

export type DomainEvent = (typeof DOMAIN_EVENTS)[number];

/**
 * The payload a hook handler receives. IDs and references only — never a
 * full payload copy and never a secret. `data` is a flat, JSON-safe field
 * map built by the publisher (same discipline as jobs queue payloads).
 */
export interface HookEventPayload {
  event: DomainEvent;
  /** Entity the event is about, e.g. "order" / "payment" / "shipment". */
  entityType: string;
  entityId: string;
  occurredAt: string; // ISO timestamp
  data: Record<string, string | number | boolean | null>;
}

export type HookHandlerResult =
  | { ok: true }
  | { ok: false; error: string };

/** A hook handler is an async function supplied by a plugin at runtime. */
export type HookHandler = (payload: HookEventPayload) => Promise<HookHandlerResult>;

export interface HookSubscription {
  id: string;
  pluginId: string;
  event: DomainEvent;
  /** Lower runs first. Core uses 0–99, plugins 100+. */
  priority: number;
  isEnabled: boolean;
}

/* ------------------------------------------------------------------ */
/* Plugin manifest                                                     */
/* ------------------------------------------------------------------ */

export const pluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "Plugin id must be kebab-case"),
  name: z.string().min(1).max(120),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Version must be semver x.y.z"),
  description: z.string().max(500).optional(),
  /** Domain events this plugin wants to receive. */
  events: z.array(z.enum(DOMAIN_EVENTS)).default([]),
  /** Adapter kinds this plugin provides implementations for. */
  providesAdapters: z.array(z.enum(["payment", "courier", "sms", "email", "storage"])).default([]),
  /** Scopes the plugin may use when calling the admin API (least privilege). */
  requestedScopes: z.array(z.string().min(1)).default([]),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export type PluginStatus = "installed" | "enabled" | "disabled" | "error";

export interface InstalledPlugin {
  manifest: PluginManifest;
  status: PluginStatus;
  installedAt: string; // ISO
}

/* ------------------------------------------------------------------ */
/* Adapter registry — payment / courier / sms / email / storage.       */
/* Adapters themselves live in src/integrations (Agent 5/9); this is   */
/* only the registry contract so plugins can register additional ones  */
/* without touching core code.                                         */
/* ------------------------------------------------------------------ */

export type AdapterKind = "payment" | "courier" | "sms" | "email" | "storage";

export interface AdapterRegistration {
  kind: AdapterKind;
  /** Provider key, e.g. "bkash", "steadfast", "bulksmsbd". */
  providerKey: string;
  displayName: string;
  /** "core" for built-in adapters, otherwise the plugin id. */
  source: string;
  /** True when the provider is in sandbox/test mode. */
  sandbox: boolean;
}

/* ------------------------------------------------------------------ */
/* Custom fields — merchant-defined extra fields on core entities.     */
/* Definitions are data (validated below); values are validated        */
/* against the definition at write time (see custom-fields.ts).        */
/* ------------------------------------------------------------------ */

export const CUSTOM_FIELD_ENTITIES = ["product", "order", "customer", "variant"] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

export const CUSTOM_FIELD_TYPES = [
  "text",
  "textarea",
  "number_poisha", // money — integer poisha, never float
  "integer",
  "boolean",
  "date",
  "select",
  "multiselect",
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const customFieldDefinitionSchema = z.object({
  id: z.string().min(1),
  entity: z.enum(CUSTOM_FIELD_ENTITIES),
  /** Machine key, unique per entity. Stored on the entity as extra JSON. */
  key: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "Key must be snake_case"),
  labelBn: z.string().min(1).max(120),
  labelEn: z.string().min(1).max(120),
  type: z.enum(CUSTOM_FIELD_TYPES),
  required: z.boolean().default(false),
  /** Required when type is select/multiselect. */
  options: z.array(z.string().min(1)).max(100).optional(),
  /** Inclusive bounds for integer / number_poisha types. */
  min: z.number().int().optional(),
  max: z.number().int().optional(),
  maxLength: z.number().int().positive().max(5000).optional(),
  /** Shown in admin forms only when true; never sent to the storefront. */
  adminOnly: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>;

/** A validated custom-field value. Money stays integer poisha. */
export type CustomFieldValue = string | number | boolean | string[] | null;

/* ------------------------------------------------------------------ */
/* Webhooks — outbound subscriptions. Delivery goes through the        */
/* "webhook-delivery" BullMQ queue (src/jobs/queues.ts QUEUE_NAMES     */
/* .webhook, payload WebhookJob { event, payloadId }). The signing     */
/* secret is stored ENCRYPTED in Admin Settings (see settings.ts) —    */
/* only a boolean "hasSecret" ever appears in API responses.           */
/* ------------------------------------------------------------------ */

export const webhookSubscriptionSchema = z.object({
  id: z.string().min(1),
  url: z.string().url().startsWith("https://", "Webhook URL must be https"),
  events: z.array(z.enum(DOMAIN_EVENTS)).min(1),
  isEnabled: z.boolean().default(true),
  /** Must be true in the stored record; the secret itself never lives here. */
  hasSecret: z.boolean(),
  description: z.string().max(200).optional(),
});

export type WebhookSubscription = z.infer<typeof webhookSubscriptionSchema>;

export type WebhookDeliveryStatus =
  | "queued"
  | "delivered"
  | "failed"
  | "retrying"
  | "dead"; // exhausted retries — staff action required, never silently dropped

export interface WebhookDeliveryLog {
  id: string;
  subscriptionId: string;
  event: DomainEvent;
  /** The WebhookJob payloadId enqueued for this delivery. */
  payloadId: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  /** HTTP status of the last attempt, when one was made. */
  httpStatus: number | null;
  /** Short reason only — never the response body, never the signature. */
  lastError: string | null;
  createdAt: string; // ISO
  deliveredAt: string | null; // ISO
}

/* ------------------------------------------------------------------ */
/* API keys — for the public/admin API and for plugins.                */
/* HASH-ONLY: the record stores sha256(plainKey). The plain key is     */
/* returned exactly once at creation (see api-keys.ts) and can never   */
/* be recovered. Scopes are module.action permission strings.          */
/* ------------------------------------------------------------------ */

export const apiKeyRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  /** Non-secret identifier shown in lists, e.g. "ak_live_9f3c". */
  keyPrefix: z.string().min(4).max(24),
  /** sha256 hex of the full plain key. The ONLY key material stored. */
  keyHash: z.string().regex(/^[a-f0-9]{64}$/),
  scopes: z.array(z.string().min(1)).min(1),
  /** Owning plugin id, or null for a merchant-created key. */
  pluginId: z.string().nullable().default(null),
  /** ISO timestamp; null = never expires (discouraged, allowed). */
  expiresAt: z.string().datetime().nullable().default(null),
  lastUsedAt: z.string().datetime().nullable().default(null),
  isRevoked: z.boolean().default(false),
  createdAt: z.string().datetime(),
});

export type ApiKeyRecord = z.infer<typeof apiKeyRecordSchema>;

/** What list/get endpoints may return — hash is NEVER included. */
export interface ApiKeyPublicView {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  pluginId: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  isRevoked: boolean;
  createdAt: string;
}
