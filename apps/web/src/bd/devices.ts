/**
 * SMS forwarder device tokens — wave 58 server companion.
 *
 * The Android SMS forwarder (apps/android-sms-forwarder/) forwards
 * merchant bKash/Nagad SMS to POST /api/v1/admin/bd/sms-ingest. Until
 * this module, that route accepted ONLY a staff session cookie — so
 * the forwarder phone held a full staff session (7-day TTL, and a
 * TOTP-enabled account cannot sign in from the app at all). Device
 * tokens fix that: each forwarder phone gets its OWN revocable
 * credential, provisioned by staff in Admin > BD Tools >
 * ডিভাইস টোকেন and sent as `Authorization: Bearer ae_dev_…`.
 *
 * Storage: ONE Setting document, key `bd.sms_devices`, an array of
 *   { id, label, tokenHash, createdAt, createdById,
 *     lastSeenAt, revokedAt }
 * written with the established doc-store mechanism (direct
 * prisma.setting.upsert + invalidateSettingCache — the generic
 * setSetting() path rejects keys outside SETTING_DEFAULTS, the same
 * reason pod.config / restaurant.config have their own stores).
 *
 * SECRETS DISCIPLINE:
 *  - The plaintext token exists exactly twice: in the create
 *    response (shown to staff ONCE) and on the phone. At rest we
 *    keep ONLY its SHA-256 hex (`tokenHash`).
 *  - `tokenHash` itself is a secret-equivalent (an offline attacker
 *    with the doc could brute-force a weak token — ours carry 256
 *    bits of entropy, so this is defence in depth) and NEVER leaves
 *    this module: list/read APIs return SmsDeviceView, which has no
 *    hash field. Same precedent as payment-link token hashes.
 *
 * AUTH READ PATH: authenticateDeviceToken() reads the doc DIRECTLY
 * from Prisma, bypassing getSetting()'s 30s in-process memo + Redis
 * layers. Revocation must bite on the next request, not up to a
 * cache TTL later; the ingest POST rate (one per merchant SMS) makes
 * one findUnique per call cheap. A corrupt/unparseable doc fails
 * CLOSED (zero devices authenticate) rather than open.
 *
 * lastSeenAt THROTTLING: a successful auth stamps lastSeenAt ONLY
 * when the stored value is missing or older than one hour
 * (LAST_SEEN_THROTTLE_MS). Without this, every forwarded SMS would
 * rewrite the Setting doc. The stamp is best-effort: it re-reads
 * the doc fresh, updates just that device, and swallows failures —
 * a failed stamp must never fail an ingest. (Read-modify-write of
 * the whole doc means two devices stamping in the same instant
 * could clobber each other's stamp; the value is a liveness hint,
 * not money, so that race is acceptable and noted here.)
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import { invalidateSettingCache } from "@/lib/settings";
import { z } from "zod";

export const SMS_DEVICES_KEY = "bd.sms_devices";

/** Max simultaneously ACTIVE (non-revoked) devices per install. */
export const MAX_SMS_DEVICES = 20;

export const LAST_SEEN_THROTTLE_MS = 60 * 60 * 1000;

const TOKEN_PREFIX = "ae_dev_";

export interface SmsDevice {
  id: string;
  label: string;
  /** SHA-256 hex of the plaintext token. Secret-equivalent — never serialised out of this module's views. */
  tokenHash: string;
  createdAt: string;
  createdById: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

/** Browser/staff-safe projection — deliberately has NO tokenHash. */
export interface SmsDeviceView {
  id: string;
  label: string;
  createdAt: string;
  createdById: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  status: "active" | "revoked";
}

/** What a successful device auth hands to the caller — id + label only. */
export interface SmsDeviceAuth {
  id: string;
  label: string;
}

const smsDeviceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.string().min(1),
  createdById: z.string().min(1),
  lastSeenAt: z.string().nullable().default(null),
  revokedAt: z.string().nullable().default(null),
});

const smsDevicesDocSchema = z.array(smsDeviceSchema).default([]);

export function toSmsDeviceView(device: SmsDevice): SmsDeviceView {
  return {
    id: device.id,
    label: device.label,
    createdAt: device.createdAt,
    createdById: device.createdById,
    lastSeenAt: device.lastSeenAt,
    revokedAt: device.revokedAt,
    status: device.revokedAt ? "revoked" : "active",
  };
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/* ------------------------------------------------------------------ */
/* Doc store                                                           */
/* ------------------------------------------------------------------ */

/** Direct-Prisma read (see the header for why the settings cache is
 *  bypassed). Fail-soft to [] on missing/corrupt doc or DB error —
 *  for AUTH that means fail-closed; for the admin list it means an
 *  honest empty list rather than a 500. */
export async function loadSmsDevices(): Promise<SmsDevice[]> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SMS_DEVICES_KEY } });
    if (!row || row.valueEncrypted || !row.value) return [];
    const parsed = smsDevicesDocSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Persist the whole doc. Throws on DB failure — callers that are
 *  answering staff (create/revoke) report 503 rather than claiming a
 *  write that did not happen. */
export async function saveSmsDevices(devices: SmsDevice[], actorId: string): Promise<void> {
  const value = JSON.stringify(devices);
  await prisma.setting.upsert({
    where: { key: SMS_DEVICES_KEY },
    create: {
      key: SMS_DEVICES_KEY,
      value,
      valueEncrypted: false,
      isPublic: false,
      category: "general",
      description: "SMS forwarder device tokens (hashes only, wave 58)",
      updatedById: actorId,
    },
    update: { value, valueEncrypted: false, updatedById: actorId },
  });
  invalidateSettingCache(SMS_DEVICES_KEY);
}

/* ------------------------------------------------------------------ */
/* Create / revoke                                                     */
/* ------------------------------------------------------------------ */

export class SmsDeviceLimitError extends Error {
  constructor() {
    super(`At most ${MAX_SMS_DEVICES} active SMS forwarder devices are allowed.`);
    this.name = "SmsDeviceLimitError";
  }
}

/** `ae_dev_` + 256 bits of entropy, base64url (43 chars). */
export function generateDeviceToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

/**
 * Create a device. Returns the stored record AND the plaintext token
 * — the ONLY time the plaintext exists server-side. Enforces the
 * active-device cap; revoked records beyond the cap are pruned from
 * the stored doc (their audit trail lives in AuditLog, not here).
 */
export async function createSmsDevice(
  label: string,
  createdById: string,
): Promise<{ device: SmsDevice; token: string }> {
  const devices = await loadSmsDevices();
  const active = devices.filter((d) => !d.revokedAt);
  if (active.length >= MAX_SMS_DEVICES) throw new SmsDeviceLimitError();
  const token = generateDeviceToken();
  const device: SmsDevice = {
    id: `smsdev-${randomBytes(6).toString("hex")}`,
    label,
    tokenHash: hashDeviceToken(token),
    createdAt: new Date().toISOString(),
    createdById,
    lastSeenAt: null,
    revokedAt: null,
  };
  // Keep the doc bounded: all active devices + newest revoked ones
  // that fit under the cap alongside them.
  const revoked = devices
    .filter((d) => d.revokedAt)
    .sort((a, b) => (b.revokedAt ?? "").localeCompare(a.revokedAt ?? ""));
  const keptRevoked = revoked.slice(0, Math.max(0, MAX_SMS_DEVICES - active.length - 1));
  await saveSmsDevices([...active, device, ...keptRevoked], createdById);
  return { device, token };
}

/** Revoke by id. Returns the updated record, or null when the id is
 *  unknown or the device is already revoked. */
export async function revokeSmsDevice(id: string, actorId: string): Promise<SmsDevice | null> {
  const devices = await loadSmsDevices();
  const device = devices.find((d) => d.id === id);
  if (!device || device.revokedAt) return null;
  device.revokedAt = new Date().toISOString();
  await saveSmsDevices(devices, actorId);
  return device;
}

/* ------------------------------------------------------------------ */
/* Authentication                                                      */
/* ------------------------------------------------------------------ */

/** Extract the bearer token from an Authorization header value.
 *  Returns null for anything that is not `Bearer ae_dev_…`. */
export function parseDeviceBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = (match[1] ?? "").trim();
  return token.startsWith(TOKEN_PREFIX) && token.length > TOKEN_PREFIX.length ? token : null;
}

/**
 * Authenticate a request's device token. Returns { id, label } on
 * success, null for a missing/malformed/unknown/revoked token —
 * callers answer all of those with the same 401 (no oracle about
 * which check failed). Hash comparison is constant-time over the
 * two 32-byte digests.
 */
export async function authenticateDeviceToken(req: Request): Promise<SmsDeviceAuth | null> {
  const token = parseDeviceBearer(req.headers.get("authorization"));
  if (!token) return null;
  const presented = Buffer.from(hashDeviceToken(token), "hex");
  const devices = await loadSmsDevices();
  for (const device of devices) {
    if (device.revokedAt) continue;
    const stored = Buffer.from(device.tokenHash, "hex");
    if (stored.length === presented.length && timingSafeEqual(stored, presented)) {
      await touchLastSeen(device);
      return { id: device.id, label: device.label };
    }
  }
  return null;
}

/** Throttled lastSeenAt stamp (see header). Best-effort by design. */
async function touchLastSeen(device: SmsDevice): Promise<void> {
  const last = device.lastSeenAt ? Date.parse(device.lastSeenAt) : NaN;
  if (Number.isFinite(last) && Date.now() - last < LAST_SEEN_THROTTLE_MS) return;
  try {
    const fresh = await loadSmsDevices();
    const target = fresh.find((d) => d.id === device.id);
    if (!target || target.revokedAt) return;
    target.lastSeenAt = new Date().toISOString();
    // Setting.updatedById is a free string (no FK): for this
    // system-driven stamp we record the device's creator so the
    // row never claims an anonymous writer; the stamp itself is
    // visible as lastSeenAt, not as a staff edit (staff edits are
    // the audited create/revoke calls).
    await saveSmsDevices(fresh, target.createdById);
  } catch {
    // A liveness stamp must never fail an ingest.
  }
}
