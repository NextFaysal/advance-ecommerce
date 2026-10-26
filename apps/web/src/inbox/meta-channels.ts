/**
 * Meta channel RECEIVE side — ADV-6 part 1 (doc 22).
 *
 * One module owns everything about hearing from Meta:
 *   - which Settings keys configure each channel (meta.* — registered
 *     in src/lib/settings.ts; app_secret + *_token values are stored
 *     encrypted by the settings service's secret-suffix rule);
 *   - diagnoseMetaChannels(): which channels are live vs not
 *     configured — field NAMES and booleans only, never values;
 *   - the webhook subscription handshake (hub.verify_token);
 *   - X-Hub-Signature-256 HMAC verification over the RAW body;
 *   - normalisation of Messenger / Instagram / WhatsApp Cloud API
 *     payloads into InboundMessageInput for the DB store's
 *     ingestInboundMessage() (which dedupes on
 *     (channel, externalMessageId), so a Meta retry is a no-op).
 *
 * Honesty rules: nothing here calls the Meta Graph API (the SEND side
 * is a separate slice). Webhook payloads carry NO sender display name
 * for Messenger/Instagram (that needs a Graph profile lookup), so
 * conversations get a neutral per-channel label until a phone/name is
 * captured in chat; WhatsApp payloads DO carry a profile name and it
 * is used. Media messages persist an honest Bangla placeholder label
 * ("[ছবি]" etc.) — never invented content. Echo, delivery and read
 * events never create messages.
 *
 * The handlers take an injected settings reader + ingest function so
 * they are unit-testable with zero network and zero DB; the public
 * route (app/api/v1/public/meta/webhook) wires the real ones.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { InboundMessageInput, InboxChannel, MessageKind } from "./types";

/* ------------------------------------------------------------------ */
/* Settings contract                                                   */
/* ------------------------------------------------------------------ */

export interface MetaSettingsReader {
  /** Effective setting value (DB -> env -> default), or null. */
  getSetting(key: string): Promise<string | null>;
}

export const META_KEYS = {
  appId: "meta.app_id",
  appSecret: "meta.app_secret",
  webhookVerifyToken: "meta.webhook_verify_token",
  pageId: "meta.page_id",
  pageAccessToken: "meta.page_access_token",
  wabaId: "meta.waba_id",
  whatsappPhoneNumberId: "meta.whatsapp_phone_number_id",
  whatsappAccessToken: "meta.whatsapp_access_token",
  igId: "meta.ig_id",
} as const;

/** Fields the webhook endpoint itself needs before it exists at all. */
export const META_CORE_FIELDS = ["app_secret", "webhook_verify_token"] as const;

/** Credential/config fields each channel needs ON TOP of the core. */
export const META_CHANNEL_FIELDS: Record<InboxChannel, readonly string[]> = {
  // Messenger rides the Facebook Page.
  MESSENGER: ["page_id", "page_access_token"],
  // Instagram messaging is served through the linked Page's token.
  INSTAGRAM: ["ig_id", "page_access_token"],
  WHATSAPP: ["whatsapp_phone_number_id", "whatsapp_access_token"],
};

const FIELD_TO_KEY: Record<string, string> = {
  app_id: META_KEYS.appId,
  app_secret: META_KEYS.appSecret,
  webhook_verify_token: META_KEYS.webhookVerifyToken,
  page_id: META_KEYS.pageId,
  page_access_token: META_KEYS.pageAccessToken,
  waba_id: META_KEYS.wabaId,
  whatsapp_phone_number_id: META_KEYS.whatsappPhoneNumberId,
  whatsapp_access_token: META_KEYS.whatsappAccessToken,
  ig_id: META_KEYS.igId,
};

export interface MetaChannelDiagnosis {
  live: boolean;
  /** Missing field names for this channel (short names, e.g. "page_id"). */
  missingFields: string[];
}

export interface MetaDiagnosis {
  /** True when the webhook endpoint can open at all (core fields present). */
  endpointConfigured: boolean;
  /** Missing core field names ("app_secret" / "webhook_verify_token"). */
  missingCoreFields: string[];
  channels: Record<InboxChannel, MetaChannelDiagnosis>;
  /** True when at least one channel is fully configured. */
  channelsLive: boolean;
}

async function safeGet(reader: MetaSettingsReader, key: string): Promise<string> {
  try {
    return ((await reader.getSetting(key)) ?? "").trim();
  } catch {
    // An unreachable/undecryptable settings store reads as "not
    // configured" — the endpoint stays closed rather than guessing.
    return "";
  }
}

async function loadMetaFields(reader: MetaSettingsReader): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [field, key] of Object.entries(FIELD_TO_KEY)) {
    out[field] = await safeGet(reader, key);
  }
  return out;
}

/** Booleans + missing field NAMES only — safe for API meta / probes. */
export async function diagnoseMetaChannels(reader: MetaSettingsReader): Promise<MetaDiagnosis> {
  const fields = await loadMetaFields(reader);
  const missingCoreFields = META_CORE_FIELDS.filter((f) => !fields[f]);
  const endpointConfigured = missingCoreFields.length === 0;
  const channels = {} as Record<InboxChannel, MetaChannelDiagnosis>;
  for (const channel of Object.keys(META_CHANNEL_FIELDS) as InboxChannel[]) {
    const missingFields = META_CHANNEL_FIELDS[channel].filter((f) => !fields[f]);
    channels[channel] = {
      live: endpointConfigured && missingFields.length === 0,
      missingFields,
    };
  }
  return {
    endpointConfigured,
    missingCoreFields,
    channels,
    channelsLive: Object.values(channels).some((c) => c.live),
  };
}

/**
 * Secret-bearing config for SERVER-SIDE use only (the webhook route's
 * signature check). Never return this from an API response.
 */
export async function loadMetaSecrets(
  reader: MetaSettingsReader,
): Promise<{ appSecret: string; webhookVerifyToken: string }> {
  const fields = await loadMetaFields(reader);
  return {
    appSecret: fields.app_secret ?? "",
    webhookVerifyToken: fields.webhook_verify_token ?? "",
  };
}

/* ------------------------------------------------------------------ */
/* Subscription handshake + signature                                  */
/* ------------------------------------------------------------------ */

/**
 * Meta's GET verification: answer the challenge ONLY when mode is
 * "subscribe" and the presented token matches the configured one.
 * Returns the challenge string to echo, or null to reject.
 */
export function metaSubscriptionChallenge(
  params: URLSearchParams,
  configuredVerifyToken: string,
): string | null {
  if (!configuredVerifyToken) return null;
  if (params.get("hub.mode") !== "subscribe") return null;
  const presented = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge");
  if (!challenge) return null;
  const a = Buffer.from(presented);
  const b = Buffer.from(configuredVerifyToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return challenge;
}

/**
 * X-Hub-Signature-256 check: "sha256=<hex HMAC of the raw body, keyed
 * with the Meta app secret>". Constant-time compare; any malformed
 * header is a reject, never an exception.
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!appSecret || !signatureHeader) return false;
  if (!signatureHeader.startsWith("sha256=")) return false;
  const presented = signatureHeader.slice("sha256=".length).trim();
  if (!/^[0-9a-fA-F]{64}$/.test(presented)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(presented.toLowerCase(), "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ */
/* Payload normalisation                                               */
/* ------------------------------------------------------------------ */

export interface NormalizedMetaMessage extends InboundMessageInput {
  /** Platform send time, ISO — persisted as the message's createdAt. */
  sentAtIso: string;
}

const MEDIA_LABELS: Record<string, { kind: MessageKind; label: string }> = {
  image: { kind: "IMAGE", label: "[ছবি]" },
  audio: { kind: "SYSTEM", label: "[অডিও বার্তা]" },
  voice: { kind: "SYSTEM", label: "[অডিও বার্তা]" },
  video: { kind: "SYSTEM", label: "[ভিডিও]" },
  file: { kind: "SYSTEM", label: "[ফাইল]" },
  document: { kind: "SYSTEM", label: "[ফাইল]" },
  sticker: { kind: "IMAGE", label: "[স্টিকার]" },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isoFromMs(ms: unknown): string {
  const n = typeof ms === "number" ? ms : Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : new Date().toISOString();
}

function isoFromSeconds(sec: unknown): string {
  const n = typeof sec === "string" ? Number(sec) : typeof sec === "number" ? sec : NaN;
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
}

/**
 * One Messenger/Instagram messaging event -> at most one message.
 * Echoes (our own sends), delivery/read receipts and bare postbacks
 * create nothing. The conversation key is the sender's scoped id —
 * the only stable thread identity a webhook payload carries.
 */
function normalizeMessagingEvent(
  eventRaw: unknown,
  channel: InboxChannel,
  defaultName: string,
): NormalizedMetaMessage | null {
  const event = asRecord(eventRaw);
  if (!event) return null;
  const senderId = str(asRecord(event.sender)?.id);
  if (!senderId) return null;
  const message = asRecord(event.message);
  if (!message) return null; // delivery / read / postback / reaction: no message row
  if (message.is_echo === true) return null; // our own outbound echo
  const mid = str(message.mid);
  if (!mid) return null;

  let kind: MessageKind = "TEXT";
  let text: string | undefined = str(message.text) || undefined;
  if (!text) {
    const attachment = asRecord(asArray(message.attachments)[0]);
    const media = MEDIA_LABELS[str(attachment?.type)] ?? { kind: "SYSTEM" as MessageKind, label: "[সংযুক্তি]" };
    kind = media.kind;
    text = media.label;
  }
  return {
    channel,
    externalThreadId: senderId,
    externalMessageId: mid,
    customerDisplayName: defaultName,
    kind,
    text,
    sentAtIso: isoFromMs(event.timestamp),
  };
}

function normalizeWhatsappChange(changeRaw: unknown): NormalizedMetaMessage[] {
  const change = asRecord(changeRaw);
  const value = asRecord(change?.value);
  if (!value) return [];
  // value.statuses[] (sent/delivered/read) is ignored by construction:
  // only value.messages[] can create rows.
  const profileNames = new Map<string, string>();
  for (const contactRaw of asArray(value.contacts)) {
    const contact = asRecord(contactRaw);
    const waId = str(contact?.wa_id);
    const name = str(asRecord(contact?.profile)?.name);
    if (waId && name) profileNames.set(waId, name);
  }
  const out: NormalizedMetaMessage[] = [];
  for (const msgRaw of asArray(value.messages)) {
    const msg = asRecord(msgRaw);
    if (!msg) continue;
    const from = str(msg.from);
    const id = str(msg.id);
    if (!from || !id) continue;
    const type = str(msg.type);
    let kind: MessageKind = "TEXT";
    let text: string | undefined;
    if (type === "text") {
      text = str(asRecord(msg.text)?.body) || undefined;
    } else if (type === "image") {
      kind = "IMAGE";
      text = str(asRecord(msg.image)?.caption) || "[ছবি]";
    } else if (MEDIA_LABELS[type]) {
      kind = MEDIA_LABELS[type]!.kind;
      text = MEDIA_LABELS[type]!.label;
    } else {
      // button / interactive / order / unknown: keep an honest marker,
      // never a fabricated body.
      kind = "SYSTEM";
      text = "[অন্য ধরনের বার্তা]";
    }
    if (!text) continue;
    out.push({
      channel: "WHATSAPP",
      externalThreadId: from,
      externalMessageId: id,
      customerDisplayName: profileNames.get(from) ?? "WhatsApp customer",
      kind,
      text,
      sentAtIso: isoFromSeconds(msg.timestamp),
    });
  }
  return out;
}

/**
 * Any Meta webhook payload -> the inbound messages it carries.
 * `object` decides the family: "page" (Messenger), "instagram",
 * "whatsapp_business_account". Unknown families yield no messages.
 */
export function normalizeMetaWebhookPayload(payload: unknown): NormalizedMetaMessage[] {
  const root = asRecord(payload);
  if (!root) return [];
  const object = str(root.object);
  const out: NormalizedMetaMessage[] = [];
  if (object === "whatsapp_business_account") {
    for (const entry of asArray(root.entry)) {
      for (const change of asArray(asRecord(entry)?.changes)) {
        out.push(...normalizeWhatsappChange(change));
      }
    }
    return out;
  }
  if (object === "page" || object === "instagram") {
    const channel: InboxChannel = object === "page" ? "MESSENGER" : "INSTAGRAM";
    const defaultName = object === "page" ? "Messenger customer" : "Instagram customer";
    for (const entry of asArray(root.entry)) {
      for (const event of asArray(asRecord(entry)?.messaging)) {
        const normalized = normalizeMessagingEvent(event, channel, defaultName);
        if (normalized) out.push(normalized);
      }
    }
    return out;
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Webhook handlers (deps injected; the route wires the real ones)   */
/* ------------------------------------------------------------------ */

export type MetaIngestFn = (
  input: NormalizedMetaMessage,
) => Promise<{ duplicate: boolean }>;

export interface MetaWebhookDeps {
  reader: MetaSettingsReader;
  ingest: MetaIngestFn;
}

export interface MetaWebhookResult {
  status: number;
  /** Plain-text body (GET handshake) — mutually exclusive with json. */
  text?: string;
  json?: Record<string, unknown>;
}

/**
 * GET handshake. Not configured at all -> 404 (the endpoint is
 * effectively closed; Meta is never told a fake success). Configured
 * but a wrong token/mode -> 403 with no challenge echoed.
 */
export async function handleMetaWebhookGet(
  url: URL,
  deps: MetaWebhookDeps,
): Promise<MetaWebhookResult> {
  const { webhookVerifyToken } = await loadMetaSecrets(deps.reader);
  if (!webhookVerifyToken) return { status: 404, json: { error: { code: "NOT_CONFIGURED" } } };
  const challenge = metaSubscriptionChallenge(url.searchParams, webhookVerifyToken);
  if (challenge === null) return { status: 403, json: { error: { code: "VERIFY_FAILED" } } };
  return { status: 200, text: challenge };
}

/**
 * POST ingestion. Order of operations is the security contract:
 *   1. not configured (no app secret) -> 404, nothing read further;
 *   2. signature over the RAW body fails -> 401, NO state change;
 *   3. only then parse + normalise + ingest (the store dedupes
 *      replays on (channel, externalMessageId)).
 * A payload with zero message events is a valid 200 (receipts etc.).
 */
export async function handleMetaWebhookPost(
  rawBody: string,
  signatureHeader: string | null,
  deps: MetaWebhookDeps,
): Promise<MetaWebhookResult> {
  const { appSecret } = await loadMetaSecrets(deps.reader);
  if (!appSecret) return { status: 404, json: { error: { code: "NOT_CONFIGURED" } } };
  if (!verifyMetaSignature(rawBody, signatureHeader, appSecret)) {
    return { status: 401, json: { error: { code: "BAD_SIGNATURE" } } };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, json: { error: { code: "BAD_JSON" } } };
  }
  const messages = normalizeMetaWebhookPayload(payload);
  let ingested = 0;
  let duplicates = 0;
  for (const message of messages) {
    const result = await deps.ingest(message);
    if (result.duplicate) duplicates += 1;
    else ingested += 1;
  }
  return { status: 200, json: { received: messages.length, ingested, duplicates } };
}

/**
 * channelsLive for the inbox API meta: computed from Settings, with
 * the per-channel breakdown so the UI can show WHICH channels are
 * live vs not configured. Degrades to all-false on any failure —
 * never claims live on an error.
 */
export async function getInboxChannelsLiveMeta(
  reader: MetaSettingsReader,
): Promise<{ channelsLive: boolean; channels: Record<InboxChannel, boolean> }> {
  try {
    const diagnosis = await diagnoseMetaChannels(reader);
    const channels = {} as Record<InboxChannel, boolean>;
    for (const channel of Object.keys(diagnosis.channels) as InboxChannel[]) {
      channels[channel] = diagnosis.channels[channel].live;
    }
    return { channelsLive: diagnosis.channelsLive, channels };
  } catch {
    return {
      channelsLive: false,
      channels: { MESSENGER: false, INSTAGRAM: false, WHATSAPP: false },
    };
  }
}
