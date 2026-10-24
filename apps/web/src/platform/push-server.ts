/**
 * Web Push — SERVER side (subscriptions persistence + real sender).
 *
 * The pure types / payload templates live in src/platform/push.ts; its
 * SandboxPushSender stays for demos. THIS module is the production
 * path and is server-only (Prisma + node:crypto):
 *
 *  - Subscriptions persist in the PushSubscription table (endpoint is
 *    the identity; subscribing again upserts the rotated keys).
 *  - Sending implements the Web Push protocol directly — RFC 8291
 *    payload encryption (aes128gcm) + RFC 8292 VAPID (ES256 JWT) —
 *    with node:crypto only; the project has no web-push dependency.
 *  - VAPID keys come from env (server-side only, never shipped to the
 *    client except the PUBLIC key, which the browser needs to
 *    subscribe):
 *      WEB_PUSH_VAPID_PUBLIC_KEY   base64url uncompressed P-256 point
 *      WEB_PUSH_VAPID_PRIVATE_KEY  base64url P-256 private scalar
 *      WEB_PUSH_VAPID_SUBJECT      https: URL or mailto: (optional)
 *  - When the keys are absent, sending returns an honest
 *    NOT_CONFIGURED result and performs NO network call — a push is
 *    never reported as sent when it was not. Use generateVapidKeys()
 *    once (ops side) to mint a key pair for the env.
 */
import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { sign as cryptoSign } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import type { PushPayload, PushSubscriptionRecord } from "./push";

/* ------------------------------------------------------------------ */
/* VAPID configuration                                                 */
/* ------------------------------------------------------------------ */

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** VAPID config from env, or null when push sending is not configured. */
export function getVapidConfig(): VapidConfig | null {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: process.env.WEB_PUSH_VAPID_SUBJECT?.trim() || "mailto:webpush@localhost",
  };
}

export function isPushConfigured(): boolean {
  return getVapidConfig() !== null;
}

/** Mint a fresh VAPID key pair (ops helper — run once, store in env). */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString("base64url"),
    privateKey: ecdh.getPrivateKey().toString("base64url"),
  };
}

/* ------------------------------------------------------------------ */
/* Subscription persistence (PushSubscription table)                   */
/* ------------------------------------------------------------------ */

type PushSubscriptionRow = Awaited<ReturnType<typeof prisma.pushSubscription.findMany>>[number];

function rowToRecord(row: PushSubscriptionRow): PushSubscriptionRecord {
  return {
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
    ...(row.customerId ? { customerId: row.customerId } : {}),
    ...(row.userAgent ? { userAgent: row.userAgent } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Subscribe (or re-subscribe): upsert by endpoint. A re-subscribe that
 * carries a customerId attaches it; an anonymous re-subscribe never
 * clears a customerId an earlier identified subscribe recorded.
 */
export async function upsertPushSubscription(
  record: PushSubscriptionRecord,
): Promise<PushSubscriptionRecord> {
  const existing = await prisma.pushSubscription.findUnique({
    where: { endpoint: record.endpoint },
  });
  const customerId = record.customerId ?? existing?.customerId ?? null;
  const row = await prisma.pushSubscription.upsert({
    where: { endpoint: record.endpoint },
    create: {
      endpoint: record.endpoint,
      p256dh: record.keys.p256dh,
      auth: record.keys.auth,
      customerId,
      userAgent: record.userAgent ?? null,
    },
    update: {
      p256dh: record.keys.p256dh,
      auth: record.keys.auth,
      customerId,
      ...(record.userAgent ? { userAgent: record.userAgent } : {}),
    },
  });
  return rowToRecord(row);
}

/** Unsubscribe by endpoint. Returns true when a row was removed. */
export async function removePushSubscription(endpoint: string): Promise<boolean> {
  const res = await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  return res.count > 0;
}

export async function listPushSubscriptionsForCustomer(
  customerId: string,
): Promise<PushSubscriptionRecord[]> {
  const rows = await prisma.pushSubscription.findMany({
    where: { customerId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(rowToRecord);
}

/* ------------------------------------------------------------------ */
/* RFC 8291 payload encryption (aes128gcm)                             */
/* ------------------------------------------------------------------ */

function hkdfSha256(ikm: Buffer, salt: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, length));
}

function encryptPayload(
  subscription: PushSubscriptionRecord,
  payloadJson: string,
): Buffer {
  const uaPublic = Buffer.from(subscription.keys.p256dh, "base64url");
  const authSecret = Buffer.from(subscription.keys.auth, "base64url");

  const ephemeral = createECDH("prime256v1");
  ephemeral.generateKeys();
  const asPublic = ephemeral.getPublicKey(); // uncompressed point, 65 bytes
  const sharedSecret = ephemeral.computeSecret(uaPublic);

  const salt = randomBytes(16);
  // RFC 8291 §3.3: key derivation chain.
  const authInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"),
    uaPublic,
    asPublic,
  ]);
  const ikm = hkdfSha256(sharedSecret, authSecret, authInfo, 32);
  const cek = hkdfSha256(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), 16);
  const nonce = hkdfSha256(ikm, salt, Buffer.from("Content-Encoding: nonce\0", "utf8"), 12);

  // Single record: payload + 0x02 (final-record padding delimiter).
  const plaintext = Buffer.concat([Buffer.from(payloadJson, "utf8"), Buffer.from([0x02])]);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  // aes128gcm header: salt(16) | record size(4, BE) | keyid length(1) | keyid.
  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ciphertext]);
}

/* ------------------------------------------------------------------ */
/* VAPID (RFC 8292) JWT                                                */
/* ------------------------------------------------------------------ */

function buildVapidAuthorization(endpoint: string, config: VapidConfig): string {
  const audience = new URL(endpoint).origin;
  const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
      sub: config.subject,
    }),
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;

  // Rebuild the key pair from the base64url scalars (JWK import).
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(config.privateKey, "base64url"));
  const point = ecdh.getPublicKey(); // 0x04 | X(32) | Y(32)
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: point.subarray(1, 33).toString("base64url"),
    y: point.subarray(33, 65).toString("base64url"),
    d: config.privateKey,
  };
  const key = createPrivateKey({ key: jwk, format: "jwk" });
  const signature = cryptoSign("sha256", Buffer.from(signingInput), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${signingInput}.${signature.toString("base64url")}, k=${config.publicKey}`;
}

/* ------------------------------------------------------------------ */
/* Sender                                                              */
/* ------------------------------------------------------------------ */

export type WebPushSendResult =
  | { ok: true; mode: "vapid"; delivered: true; statusCode: number }
  | { ok: false; mode: "not-configured"; delivered: false; note: string }
  | {
      ok: false;
      mode: "vapid";
      delivered: false;
      statusCode?: number;
      /** True when the push service says the subscription is gone
       *  (404/410) — callers should delete the stored subscription. */
      gone?: boolean;
      note: string;
    };

/**
 * Send ONE push. NOT_CONFIGURED (no VAPID keys in env) performs no
 * network call and says so. Network errors are reported, never thrown.
 */
export async function sendWebPush(
  subscription: PushSubscriptionRecord,
  payload: PushPayload,
  options: { ttlSeconds?: number } = {},
): Promise<WebPushSendResult> {
  const config = getVapidConfig();
  if (!config) {
    return {
      ok: false,
      mode: "not-configured",
      delivered: false,
      note: "Web push is NOT_CONFIGURED: WEB_PUSH_VAPID_PUBLIC_KEY / WEB_PUSH_VAPID_PRIVATE_KEY are not set. No push was sent.",
    };
  }
  let body: Buffer;
  let authorization: string;
  try {
    body = encryptPayload(subscription, JSON.stringify(payload));
    authorization = buildVapidAuthorization(subscription.endpoint, config);
  } catch (err) {
    return {
      ok: false,
      mode: "vapid",
      delivered: false,
      note: `Push preparation failed (invalid subscription keys or VAPID config): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  let response: Response;
  try {
    response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(options.ttlSeconds ?? 86_400),
      },
      body: new Uint8Array(body),
    });
  } catch (err) {
    return {
      ok: false,
      mode: "vapid",
      delivered: false,
      note: `Push service unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (response.status >= 200 && response.status < 300) {
    return { ok: true, mode: "vapid", delivered: true, statusCode: response.status };
  }
  const gone = response.status === 404 || response.status === 410;
  return {
    ok: false,
    mode: "vapid",
    delivered: false,
    statusCode: response.status,
    ...(gone ? { gone: true } : {}),
    note: gone
      ? "Push service reports the subscription is gone (404/410); the stored subscription should be removed."
      : `Push service rejected the send with HTTP ${response.status}.`,
  };
}

/**
 * Send a payload to every stored subscription of one customer.
 * Subscriptions the push service reports as gone are deleted.
 */
export async function sendPushToCustomer(
  customerId: string,
  payload: PushPayload,
): Promise<{ attempted: number; delivered: number; removed: number; notConfigured: boolean }> {
  const subscriptions = await listPushSubscriptionsForCustomer(customerId);
  let delivered = 0;
  let removed = 0;
  let notConfigured = false;
  for (const subscription of subscriptions) {
    const result = await sendWebPush(subscription, payload);
    if (result.mode === "not-configured") notConfigured = true;
    if (result.delivered) delivered += 1;
    if (!result.ok && result.mode === "vapid" && result.gone) {
      await removePushSubscription(subscription.endpoint);
      removed += 1;
    }
  }
  return { attempted: subscriptions.length, delivered, removed, notConfigured };
}
