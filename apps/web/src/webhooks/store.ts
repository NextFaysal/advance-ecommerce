/**
 * Webhook endpoint + delivery store — ADV-26 (doc 22).
 *
 * Secret discipline (mirrors the gift-card / API-key conventions):
 *  - createEndpoint generates the signing secret, stores it ONLY as
 *    AES-256-GCM ciphertext (lib/settings encryptValue — recoverable
 *    because the worker must sign with it) plus a display prefix, and
 *    returns the plaintext EXACTLY ONCE in CreatedWebhookEndpoint.
 *  - No list/read path ever returns the secret or its ciphertext.
 *  - URLs pass the SSRF guard (ssrf.ts) before any row is written.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import { decryptValue, encryptValue } from "../lib/settings";
import { isWebhookEventName, type WebhookEventName } from "./events";
import { assertWebhookUrlAllowed } from "./ssrf";

export interface WebhookEndpointView {
  id: string;
  name: string;
  url: string;
  events: string[];
  secretPrefix: string;
  enabled: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedWebhookEndpoint extends WebhookEndpointView {
  /** Plaintext signing secret — returned ONCE, never stored in clear. */
  secret: string;
}

type EndpointRow = Awaited<ReturnType<typeof prisma.webhookEndpoint.findMany>>[number];

function toView(row: EndpointRow): WebhookEndpointView {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    events: row.events,
    secretPrefix: row.secretPrefix,
    enabled: row.enabled,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** `whsec_` + 32 url-safe chars. Prefix shown in admin = first 10. */
export function generateWebhookSecret(): { secret: string; prefix: string } {
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  return { secret, prefix: `${secret.slice(0, 10)}…` };
}

export function validateEvents(events: string[]): WebhookEventName[] {
  const out: WebhookEventName[] = [];
  for (const e of events) {
    if (!isWebhookEventName(e)) throw new Error(`UNKNOWN_EVENT:${e}`);
    if (!out.includes(e)) out.push(e);
  }
  if (out.length === 0) throw new Error("NO_EVENTS");
  return out;
}

export async function createEndpoint(input: {
  name: string;
  url: string;
  events: string[];
  createdById: string;
}): Promise<CreatedWebhookEndpoint> {
  assertWebhookUrlAllowed(input.url); // throws WebhookUrlError
  const events = validateEvents(input.events);
  const { secret, prefix } = generateWebhookSecret();
  const row = await prisma.webhookEndpoint.create({
    data: {
      name: input.name,
      url: input.url,
      events,
      secretEncrypted: encryptValue(secret),
      secretPrefix: prefix,
      createdById: input.createdById,
    },
  });
  return { ...toView(row), secret };
}

export async function listEndpoints(): Promise<WebhookEndpointView[]> {
  const rows = await prisma.webhookEndpoint.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(toView);
}

/** Enabled endpoints subscribed to `event` (dispatch fan-out input). */
export async function listEndpointsForEvent(event: WebhookEventName) {
  return prisma.webhookEndpoint.findMany({
    where: { enabled: true, events: { has: event } },
    orderBy: { createdAt: "asc" },
  });
}

export async function updateEndpoint(
  id: string,
  patch: { name?: string; url?: string; events?: string[]; enabled?: boolean },
): Promise<WebhookEndpointView | null> {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.url !== undefined) {
    assertWebhookUrlAllowed(patch.url);
    data.url = patch.url;
  }
  if (patch.events !== undefined) data.events = validateEvents(patch.events);
  if (patch.enabled !== undefined) data.enabled = patch.enabled;
  const existing = await prisma.webhookEndpoint.findUnique({ where: { id } });
  if (!existing) return null;
  const row = await prisma.webhookEndpoint.update({ where: { id }, data });
  return toView(row);
}

export async function deleteEndpoint(id: string): Promise<boolean> {
  const result = await prisma.webhookEndpoint.deleteMany({ where: { id } });
  return result.count > 0;
}

/** Decrypt an endpoint's signing secret in-process (worker/admin only). */
export async function resolveEndpointSecret(endpointId: string): Promise<string | null> {
  const row = await prisma.webhookEndpoint.findUnique({
    where: { id: endpointId },
    select: { secretEncrypted: true },
  });
  if (!row) return null;
  try {
    return decryptValue(row.secretEncrypted);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Deliveries                                                          */
/* ------------------------------------------------------------------ */

export interface WebhookDeliveryView {
  id: string;
  endpointId: string;
  event: string;
  entityId: string | null;
  status: string;
  attempts: number;
  responseCode: number | null;
  responseSnippet: string | null;
  lastError: string | null;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type DeliveryRow = Awaited<ReturnType<typeof prisma.webhookDelivery.findMany>>[number];

export function toDeliveryView(row: DeliveryRow): WebhookDeliveryView {
  return {
    id: row.id,
    endpointId: row.endpointId,
    event: row.event,
    entityId: row.entityId,
    status: row.status,
    attempts: row.attempts,
    responseCode: row.responseCode,
    responseSnippet: row.responseSnippet,
    lastError: row.lastError,
    nextRetryAt: row.nextRetryAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listDeliveries(filter: {
  status?: string;
  endpointId?: string;
  limit?: number;
}): Promise<WebhookDeliveryView[]> {
  const rows = await prisma.webhookDelivery.findMany({
    where: {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.endpointId ? { endpointId: filter.endpointId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(filter.limit ?? 50, 1), 200),
  });
  return rows.map(toDeliveryView);
}

/**
 * Manual redeliver: reset a FAILED/DEAD (or stuck PENDING) delivery to
 * PENDING with a fresh attempt budget. Returns the row or null. The
 * caller enqueues the job (dispatch.enqueueWebhookDelivery).
 */
export async function resetDeliveryForRedeliver(id: string) {
  const existing = await prisma.webhookDelivery.findUnique({ where: { id } });
  if (!existing) return null;
  if (existing.status === "SENT") return existing; // delivered is final
  return prisma.webhookDelivery.update({
    where: { id },
    data: { status: "PENDING", attempts: 0, nextRetryAt: null, lastError: null },
  });
}
