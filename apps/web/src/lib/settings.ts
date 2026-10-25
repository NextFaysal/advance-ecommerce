/**
 * Settings — typed key-value store, server-side only.
 *
 * Resolution order (this is the admin-configurable contract):
 *   1. Admin Settings row in the DB (encrypted if secret)  → override
 *   2. Environment variable (default / fallback)
 *   3. Built-in default below
 *
 * This is how Storage (R2), Email (Resend + SMTP), SMS (all providers),
 * Payment (all methods) and Courier (all providers) will later be
 * admin-configurable. NO provider credential is hardcoded here and no
 * credential may be returned by a "safe" getter — use
 * getIntegrationConfigWithSecrets() only inside a server-side adapter,
 * never in an API response or a client component.
 *
 * Encryption: AES-256-GCM. The key comes from SETTINGS_ENCRYPTION_KEY in
 * .env.local (a 64-hex-char / 32-byte key, generated once, never committed).
 * If the key is missing, encrypting a secret throws — secrets are never
 * silently stored as plaintext.
 *
 * Cache: settings are cached (Redis in production, in-memory Map fallback
 * for local dev only). setSetting() always invalidates the cache key.
 */
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import { writeAudit } from "./audit";

export type SettingCategory =
  | "general"
  | "storage"
  | "email"
  | "sms"
  | "payment"
  | "courier"
  | "notification"
  | "branding"
  | "seo"
  | "accounting";

export const STORAGE_PROVIDERS = ["r2", "s3"] as const;
export const EMAIL_PROVIDERS = ["resend", "smtp"] as const;
export const SMS_PROVIDERS = ["bulksmsbd", "sslwireless", "greenweb"] as const;
export const PAYMENT_PROVIDERS = [
  "cod", "bkash", "nagad", "rocket", "upay", "sslcommerz", "aamarpay", "shurjopay", "stripe", "paypal",
] as const;
export const COURIER_PROVIDERS = ["steadfast", "pathao", "redx", "paperfly", "ecourier"] as const;

export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];
export type SmsProvider = (typeof SMS_PROVIDERS)[number];
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];
export type CourierProvider = (typeof COURIER_PROVIDERS)[number];

/** Built-in defaults. Env values override these; DB rows override env. */
export const SETTING_DEFAULTS: Record<string, { category: SettingCategory; value: string; isPublic: boolean }> = {
  "general.locale": { category: "general", value: "bn", isPublic: true },
  "general.currency": { category: "general", value: "BDT", isPublic: true },
  "general.timezone": { category: "general", value: "Asia/Dhaka", isPublic: true },
  "general.store_name": { category: "general", value: "", isPublic: true },
  "storage.provider": { category: "storage", value: "r2", isPublic: false },
  "storage.cdn_url": { category: "storage", value: "", isPublic: true },
  "email.provider": { category: "email", value: "resend", isPublic: false },
  "email.from_name": { category: "email", value: "", isPublic: true },
  "sms.provider": { category: "sms", value: "", isPublic: false },
  "sms.sender_id": { category: "sms", value: "", isPublic: false },
  // VAT rate in basis points (1500 = 15%). EMPTY default = NOT
  // configured — there is deliberately no built-in rate: order creation
  // records a VAT split (Order.vatPoisha / vatRateBps) only while this
  // key holds a valid rate in the DB; the ERP sales-VAT report reads
  // only orders that carry a recorded split.
  "accounting.vat_rate_bps": { category: "accounting", value: "", isPublic: false },
  // Call-center SLA thresholds, in minutes (C2 supervisor console). A
  // PENDING_ORDER confirmation task still unattempted this long after
  // creation is an SLA breach on the supervisor board; same for a
  // FAILED_DELIVERY rescue task. Plain built-in defaults — the
  // supervisor store falls back to the same numbers when a stored
  // value is missing or not a positive integer. Registered so
  // setSetting() accepts them (the category enum has no call-center
  // member; settingCategoryForKey falls back to "general" for this
  // prefix, exactly as it does for any unlisted prefix).
  "call_center.sla_confirm_minutes": { category: "general", value: "30", isPublic: false },
  "call_center.sla_rescue_minutes": { category: "general", value: "60", isPublic: false },
  // Call-center follow-up automation (C4 — src/callcenter/automation.ts).
  // All four are read at decision/send time so an admin edit takes
  // effect on the next outcome without a redeploy. The automation
  // itself is gated by the module.call_center_automation kill-switch
  // flag (seeded OFF), independent of these values.
  // Minutes after a NO_ANSWER outcome before the "we tried to reach
  // you" SMS goes out (0 = immediately).
  "call_center.auto_sms_no_answer_minutes": { category: "general", value: "15", isPublic: false },
  // Minutes BEFORE a scheduled callback at which the reminder SMS
  // goes out (if that moment is already past, it sends immediately).
  "call_center.callback_reminder_minutes": { category: "general", value: "10", isPublic: false },
  // Legal calling window (Asia/Dhaka) for no-answer retries: a retry
  // time landing outside [start, end) is clamped to the next window
  // opening. Whole hours, 0-23.
  "call_center.calling_start_hour": { category: "general", value: "9", isPublic: false },
  "call_center.calling_end_hour": { category: "general", value: "21", isPublic: false },
  // Call-center data retention (C7 / doc 15 R6.2 —
  // src/callcenter/retention.ts). Call-log free text (note/qaComment)
  // and terminal-task PII (full phone, name, note) older than this
  // many calendar months are anonymized by the retention job; outcomes,
  // dispositions, scores and timestamps are kept so reporting survives.
  "call_center.log_retention_months": { category: "general", value: "12", isPublic: false },
};

/** Env fallback map: setting key -> env var name. No secret value lives here. */
export const SETTING_ENV_FALLBACK: Record<string, string> = {
  "storage.provider": "STORAGE_PROVIDER",
  "storage.cdn_url": "NEXT_PUBLIC_CDN_URL",
  "email.provider": "EMAIL_PROVIDER",
  "email.from_name": "EMAIL_FROM_NAME",
  "sms.provider": "SMS_PROVIDER",
  "sms.sender_id": "SMS_SENDER_ID",
};

const SECRET_KEY_SUFFIXES = ["api_key", "secret", "password", "token", "private_key", "client_secret", "access_key"];

export function isSecretSettingKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_KEY_SUFFIXES.some((suffix) => lower.endsWith(suffix) || lower.includes(`.${suffix}`));
}

export function isKnownSettingKey(key: string): boolean {
  if (key in SETTING_DEFAULTS) return true;
  // Provider-scoped keys follow a strict pattern: <category>.<provider>.<field>
  // e.g. payment.bkash.enabled, courier.steadfast.enabled, sms.bulksmsbd.api_key
  return /^(storage|email|sms|payment|courier|notification|branding|seo|general)\.[a-z0-9_]+\.[a-z0-9_]+$/.test(key);
}

function settingCategoryForKey(key: string): SettingCategory {
  const prefix = key.split(".")[0] as SettingCategory;
  const allowed: SettingCategory[] = ["general", "storage", "email", "sms", "payment", "courier", "notification", "branding", "seo", "accounting"];
  return allowed.includes(prefix) ? prefix : "general";
}

/* ------------------------------------------------------------------ */
/* Encryption (AES-256-GCM, format: v1:<iv-hex>:<tag-hex>:<cipher-hex>) */
/* ------------------------------------------------------------------ */

function encryptionKey(): Buffer {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY;
  if (raw === undefined || raw === "") {
    throw new Error("SETTINGS_ENCRYPTION_KEY is not set — refusing to store a secret. Set it in .env.local (64 hex chars).");
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) throw new Error("SETTINGS_ENCRYPTION_KEY must be 32 bytes (64 hex chars).");
  return key;
}

export function encryptValue(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptValue(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Unsupported encrypted value format.");
  const [, ivHex, tagHex, cipherHex] = parts;
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivHex as string, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex as string, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(cipherHex as string, "hex")), decipher.final()]).toString("utf8");
}

/* ------------------------------------------------------------------ */
/* Cache — in-memory fallback for local dev; Redis in production.     */
/* ------------------------------------------------------------------ */

const settingsCache = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheGet(key: string): string | null {
  const entry = settingsCache.get(key);
  if (entry === undefined || entry.expiresAt < Date.now()) {
    settingsCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key: string, value: string): void {
  settingsCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidateSettingCache(key?: string): void {
  if (key === undefined) {
    settingsCache.clear();
  } else {
    settingsCache.delete(key);
  }
}

/* ------------------------------------------------------------------ */
/* Get / set                                                           */
/* ------------------------------------------------------------------ */

export async function getSetting(key: string): Promise<string | null> {
  const cached = cacheGet(key);
  if (cached !== null) return cached;
  const row = await prisma.setting.findUnique({ where: { key } });
  if (row !== null) {
    const value = row.valueEncrypted ? decryptValue(row.value) : row.value;
    cacheSet(key, value);
    return value;
  }
  const envName = SETTING_ENV_FALLBACK[key];
  if (envName !== undefined) {
    const envValue = process.env[envName];
    if (envValue !== undefined && envValue !== "") return envValue;
  }
  return SETTING_DEFAULTS[key]?.value ?? null;
}

export async function setSetting(input: {
  key: string;
  value: string;
  actorId: string;
  reason?: string;
  isPublic?: boolean;
}): Promise<void> {
  if (!isKnownSettingKey(input.key)) throw new Error(`Unknown setting key: ${input.key}`);
  const secret = isSecretSettingKey(input.key);
  const storedValue = secret ? encryptValue(input.value) : input.value;
  const previous = await prisma.setting.findUnique({ where: { key: input.key } });
  await prisma.setting.upsert({
    where: { key: input.key },
    create: {
      key: input.key,
      value: storedValue,
      valueEncrypted: secret,
      isPublic: input.isPublic ?? SETTING_DEFAULTS[input.key]?.isPublic ?? false,
      category: settingCategoryForKey(input.key),
      updatedById: input.actorId,
    },
    update: {
      value: storedValue,
      valueEncrypted: secret,
      updatedById: input.actorId,
    },
  });
  invalidateSettingCache(input.key);
  await writeAudit({
    actorId: input.actorId,
    action: "settings.update",
    entityType: "Setting",
    entityId: input.key,
    // Never put a credential in an audit record — only that it changed.
    beforeJson: previous ? { key: input.key, valueEncrypted: previous.valueEncrypted, changed: true } : null,
    afterJson: { key: input.key, valueEncrypted: secret, changed: true },
    reason: input.reason,
  });
}

/** Public (non-secret) settings only — safe for admin list / client use. */
export async function getPublicSettings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({ where: { isPublic: true } });
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (!row.valueEncrypted) out[row.key] = row.value;
  }
  for (const [key, def] of Object.entries(SETTING_DEFAULTS)) {
    if (def.isPublic && !(key in out)) out[key] = def.value;
  }
  return out;
}

export interface IntegrationStatus {
  provider: string;
  enabled: boolean;
  configured: boolean; // a credential row exists — never the credential itself
}

/** Admin list view: per-provider enabled/configured flags, secrets redacted. */
export async function getIntegrationStatus(
  category: "payment" | "courier" | "sms" | "email" | "storage",
  providers: readonly string[],
): Promise<IntegrationStatus[]> {
  const out: IntegrationStatus[] = [];
  for (const provider of providers) {
    const enabled = (await getSetting(`${category}.${provider}.enabled`)) === "true";
    const credentialKeys = [
      `${category}.${provider}.api_key`,
      `${category}.${provider}.secret`,
      `${category}.${provider}.password`,
      `${category}.${provider}.token`,
    ];
    let configured = false;
    for (const key of credentialKeys) {
      const row = await prisma.setting.findUnique({ where: { key } });
      if (row !== null && row.value !== "") {
        configured = true;
        break;
      }
    }
    out.push({ provider, enabled, configured });
  }
  return out;
}

/**
 * Server-side adapter use ONLY. Returns credential values for one provider.
 * Callers must never return this object from an API route.
 */
export async function getIntegrationConfigWithSecrets(
  category: "payment" | "courier" | "sms" | "email" | "storage",
  provider: string,
): Promise<Record<string, string>> {
  const prefix = `${category}.${provider}.`;
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: prefix } } });
  const out: Record<string, string> = {};
  for (const row of rows) {
    out[row.key.slice(prefix.length)] = row.valueEncrypted ? decryptValue(row.value) : row.value;
  }
  return out;
}
