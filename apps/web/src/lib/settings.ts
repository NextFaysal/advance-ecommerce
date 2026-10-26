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
  // EMI display (ADV-18B — src/marketing/emi.ts). DISPLAY ONLY: no
  // gateway, no change to amounts charged; the breakdown is computed
  // from these values and labelled as bank-card terms. months is a
  // comma list of tenures; surcharge_bps applies once over the tenure.
  "payments.emi.enabled": { category: "payment", value: "false", isPublic: false },
  "payments.emi.months": { category: "payment", value: "3,6,12", isPublic: false },
  "payments.emi.surcharge_bps": { category: "payment", value: "0", isPublic: false },
  "payments.emi.min_order_poisha": { category: "payment", value: "0", isPublic: false },
  "general.store_address": { category: "general", value: "", isPublic: false },
  "general.store_bin": { category: "general", value: "", isPublic: false },
  "storage.provider": { category: "storage", value: "r2", isPublic: false },
  "storage.cdn_url": { category: "storage", value: "", isPublic: true },
  "email.provider": { category: "email", value: "resend", isPublic: false },
  "email.from_name": { category: "email", value: "", isPublic: true },
  // Sender ADDRESS for the ADV-3 email transport (src/email/config.ts).
  // Empty = NOT configured: with no from-address the transport honestly
  // resolves to not-configured and queued lifecycle emails SKIP.
  "email.from_address": { category: "email", value: "", isPublic: false },
  "sms.provider": { category: "sms", value: "", isPublic: false },
  "sms.sender_id": { category: "sms", value: "", isPublic: false },
  // Fallback gateway for ADV-2 (src/integrations/sms-resolver.ts):
  // when the active provider is not configured (disabled or missing
  // credentials) but the fallback is, sends route through the fallback.
  // Per-provider credentials/enabled ride the provider-scoped pattern
  // (sms.<provider>.api_key / api_token / token / sid / sender_id /
  // enabled) — see sms-resolver.ts for the required-field table.
  "sms.fallback_provider": { category: "sms", value: "", isPublic: false },
  // Meta / F-commerce channel credentials (ADV-6 — src/inbox/meta-channels.ts).
  // The category enum has no "meta" member, so these ride "general"
  // (settingCategoryForKey's fallback for unlisted prefixes, exactly
  // like call_center.* / orders.*). app_secret + every *_token key is
  // a secret by the suffix rule in isSecretSettingKey() and is stored
  // encrypted; ids are plain config. ALL default empty = NOT
  // configured: the Meta webhook endpoint stays closed (404) and
  // channelsLive stays false until the fields a channel needs exist.
  "meta.app_id": { category: "general", value: "", isPublic: false },
  "meta.app_secret": { category: "general", value: "", isPublic: false },
  "meta.webhook_verify_token": { category: "general", value: "", isPublic: false },
  "meta.page_id": { category: "general", value: "", isPublic: false },
  "meta.page_access_token": { category: "general", value: "", isPublic: false },
  "meta.waba_id": { category: "general", value: "", isPublic: false },
  "meta.whatsapp_phone_number_id": { category: "general", value: "", isPublic: false },
  "meta.whatsapp_access_token": { category: "general", value: "", isPublic: false },
  "meta.ig_id": { category: "general", value: "", isPublic: false },
  // Google customer sign-in (ADV-15 — src/customer-auth/google.ts).
  // client_secret is a secret by the suffix rule in
  // isSecretSettingKey() ("client_secret" is a listed suffix) and is
  // stored encrypted; the client id is plain config. BOTH default
  // empty = NOT configured: the Google start route answers 503 and
  // the login page does not render the Google button at all.
  "auth.google.client_id": { category: "general", value: "", isPublic: false },
  "auth.google.client_secret": { category: "general", value: "", isPublic: false },
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
  // Shipping engine (doc 17 O2 — src/checkout/shipping.ts). Rates are
  // integer poisha; reads fall back to these defaults, which are the
  // pre-O2 hardcoded charges. Registered so setSetting() accepts them
  // (the category enum has no shipping member; they live under
  // "general" like the call-center keys). isPublic: rates are price
  // config, not secrets. weight_slabs is a JSON array of
  // { upToGrams, addPoisha } bands — empty = no weight component;
  // the exact slab semantics are documented in
  // src/checkout/shipping-core.ts.
  "shipping.inside_dhaka_poisha": { category: "general", value: "6000", isPublic: true },
  "shipping.outside_dhaka_poisha": { category: "general", value: "12000", isPublic: true },
  "shipping.pickup_poisha": { category: "general", value: "0", isPublic: true },
  // Subtotal (poisha) at/above which delivery is free. 0 = OFF.
  "shipping.free_above_poisha": { category: "general", value: "0", isPublic: true },
  // Flat COD handling fee (poisha), added by the caller for COD only.
  "shipping.cod_fee_poisha": { category: "general", value: "0", isPublic: true },
  "shipping.weight_slabs": { category: "general", value: "", isPublic: true },
  // Call-center data retention (C7 / doc 15 R6.2 —
  // src/callcenter/retention.ts). Call-log free text (note/qaComment)
  // and terminal-task PII (full phone, name, note) older than this
  // many calendar months are anonymized by the retention job; outcomes,
  // dispositions, scores and timestamps are kept so reporting survives.
  "call_center.log_retention_months": { category: "general", value: "12", isPublic: false },
  // F-commerce order bot v1 (doc 22 ADV-6 part 3 — src/inbox/bot.ts).
  // The bot (parser + rules, NO LLM) auto-builds an order draft from a
  // conversation's messages for staff one-tap confirm. It runs ONLY
  // when the module.f_commerce feature flag is ON AND this setting is
  // "true" — default OFF, so installing the code changes nothing until
  // an admin deliberately enables the bot.
  "f_commerce.bot_enabled": { category: "general", value: "false", isPublic: false },
  // Reseller tier engine (ADV-12, src/reseller/tiers.ts). JSON maps keyed
  // by tier name; invalid/missing fields fall back per-field to the
  // built-in defaults in DEFAULT_TIER_CONFIG. Rates are basis points;
  // thresholds are LIFETIME EARNED COMMISSION in poisha needed to reach
  // the tier (BRONZE is always 0).
  "reseller.tiers.rates_bps": {
    category: "general",
    value: "{\"BRONZE\":500,\"SILVER\":750,\"GOLD\":1000,\"PLATINUM\":1250}",
    isPublic: false,
  },
  "reseller.tiers.thresholds_poisha": {
    category: "general",
    value: "{\"BRONZE\":0,\"SILVER\":2500000,\"GOLD\":10000000,\"PLATINUM\":50000000}",
    isPublic: false,
  },
  // Inventory depth (ADV-20, src/inventory/analytics.ts +
  // src/inventory/reorder.ts; surfaces gated by module.inventory_depth).
  // Days without a sale before a stocked variant counts as dead stock.
  "inventory.dead_stock_days": { category: "general", value: "90", isPublic: false },
  // Days ahead the expiring-soon batch list looks (doc 22 acceptance: 30).
  "inventory.expiry_warning_days": { category: "general", value: "30", isPublic: false },
  // Auto-reorder fallbacks. A variant is a reorder candidate when its
  // canonical stock (ProductVariant.stock) is at/below its point:
  // per-variant override (inventory.reorder.overrides JSON) → default.
  // Empty default_point = no global rule (overrides only).
  "inventory.reorder.default_point": { category: "general", value: "", isPublic: false },
  "inventory.reorder.default_qty": { category: "general", value: "", isPublic: false },
  // Supplier used when neither a per-variant override nor the variant's
  // own purchase history names one. Empty = such variants are skipped
  // with a no_supplier report entry, never guessed.
  "inventory.reorder.default_supplier_id": { category: "general", value: "", isPublic: false },
  // JSON map: { "<variantId>": { "point": 10, "qty": 50,
  // "supplierId": "..." } } — every field optional per variant.
  "inventory.reorder.overrides": { category: "general", value: "{}", isPublic: false },
  // Membership tiers (ADV-18, src/marketing/membership-tiers.ts). One
  // JSON document: an ordered ladder of { key, labelBn, labelEn,
  // thresholdPoisha, discountBps, freeShipping }. Thresholds are
  // LIFETIME DELIVERED spend in poisha needed to reach the tier (the
  // first tier's threshold is always 0). Invalid/missing documents
  // fall back to the built-in defaults in DEFAULT_MEMBERSHIP_TIERS.
  "loyalty.tiers.config": {
    category: "general",
    value: "{\"tiers\":[{\"key\":\"REGULAR\",\"labelBn\":\"সাধারণ\",\"labelEn\":\"Regular\",\"thresholdPoisha\":0,\"discountBps\":0,\"freeShipping\":false},{\"key\":\"SILVER\",\"labelBn\":\"সিলভার\",\"labelEn\":\"Silver\",\"thresholdPoisha\":5000000,\"discountBps\":200,\"freeShipping\":false},{\"key\":\"GOLD\",\"labelBn\":\"গোল্ড\",\"labelEn\":\"Gold\",\"thresholdPoisha\":20000000,\"discountBps\":500,\"freeShipping\":true},{\"key\":\"PLATINUM\",\"labelBn\":\"প্লাটিনাম\",\"labelEn\":\"Platinum\",\"thresholdPoisha\":50000000,\"discountBps\":1000,\"freeShipping\":true}]}",
    isPublic: false,
  },
  // Birthday offers (schema wave 2, src/marketing/birthday.ts): a
  // customer whose birthday (MM-DD, Asia/Dhaka) falls within the next
  // window_days days gets a deterministic per-year coupon
  // BDAY-<customerId>-<year> at discount_bps percent off. The unique
  // code IS the dedupe — re-runs never double-issue.
  "loyalty.birthday.window_days": { category: "general", value: "3", isPublic: false },
  "loyalty.birthday.discount_bps": { category: "general", value: "1000", isPublic: false },
  // Order-create rules (wave 20, plan 17 batch O2 —
  // src/checkout/order-rules.ts, enforced in the public create route).
  // Every rule defaults OFF / permissive: an unconfigured shop checks
  // out exactly as before. Registered so setSetting() accepts them
  // (the category enum has no orders member; "general" is the fallback
  // for unlisted prefixes, same as the call_center.* keys above).
  // Minimum merchandise subtotal (poisha) for a public order; 0 = off.
  "orders.rules.min_order_poisha": { category: "general", value: "0", isPublic: false },
  // Comma/newline-separated district names where COD is refused
  // (matched case-insensitively against the submitted district).
  "orders.rules.cod_disabled_districts": { category: "general", value: "", isPublic: false },
  // Comma/newline-separated category slugs: an order containing any
  // item from one of these categories cannot be paid COD.
  "orders.rules.cod_disabled_categories": { category: "general", value: "", isPublic: false },
  // COD orders whose grand total exceeds this (poisha) are flagged
  // advance-required in the create response (meta only this wave —
  // collection/enforcement is plan 17 batch O3). 0 = off.
  "orders.rules.advance_required_above_poisha": { category: "general", value: "0", isPublic: false },
  // Percent of the grand total asked as advance when the rule above
  // fires (integer 1-100; invalid stored values fall back to 20).
  "orders.rules.advance_percent": { category: "general", value: "20", isPublic: false },
  // Approval workflows (ADV-27, doc 22 — src/orders/approvals.ts).
  // Master toggle defaults OFF: an unconfigured shop confirms and
  // refunds exactly as before (fail-open by design). When ON, an
  // order whose recorded discount share reaches
  // discount_threshold_bps of its subtotal cannot be confirmed until
  // a manager (orders.edit) approves at /admin/approvals, and a
  // refund above refund_threshold_poisha cannot be SENT until
  // approved. Records persist as a JSON doc under the exact key
  // "orders.approvals" (written directly via the doc store, not via
  // setSetting — same pattern as warehouse.pick_lists).
  "orders.approvals.enabled": { category: "general", value: "false", isPublic: false },
  "orders.approvals.discount_threshold_bps": { category: "general", value: "3000", isPublic: false },
  "orders.approvals.refund_threshold_poisha": { category: "general", value: "100000", isPublic: false },
  // Delivery slots offered at checkout (doc 17 batch O9-2 —
  // src/checkout/delivery-slots.ts): a JSON array of
  // { id, labelBn, labelEn }. The value below MUST stay in sync with
  // DEFAULT_DELIVERY_SLOTS in that module (it cannot import from
  // there without a cycle). Writable through the generic settings
  // POST like every orders.* key; a dedicated editor UI shipped in
  // wave 28 (doc 18 F2-1) at app/admin/settings/orders
  // (delivery-slots-card.tsx).
  "orders.delivery_slots": {
    category: "general",
    value:
      '[{"id":"morning","labelBn":"সকাল (৯টা – দুপুর ১টা)","labelEn":"Morning (9am – 1pm)"},{"id":"afternoon","labelBn":"দুপুর–বিকেল (১টা – ৬টা)","labelEn":"Afternoon (1pm – 6pm)"},{"id":"evening","labelBn":"সন্ধ্যা (৬টা – রাত ১০টা)","labelEn":"Evening (6pm – 10pm)"}]',
    isPublic: false,
  },
  // Pickup points for click & collect (ADV-19 — src/checkout/
  // pickup-points.ts): a JSON array of { id, name, address, hours }.
  // The default is deliberately an EMPTY list — there are no honest
  // built-in store addresses; the merchant configures real points in
  // Settings > Orders. MUST stay in sync with EMPTY_PICKUP_POINTS_JSON
  // in that module (no import — cycle).
  "stores.pickup_points": {
    category: "general",
    value: "[]",
    isPublic: false,
  },
  // Retail store locations shown on /stores alongside the pickup
  // points (ADV-19 — src/checkout/pickup-points.ts). Same JSON shape;
  // these are display-only (not offered as checkout pickup choices).
  "stores.retail_locations": {
    category: "general",
    value: "[]",
    isPublic: false,
  },
  // Age-restricted categories (ADV-29 — src/catalog/age-restrictions.ts):
  // a JSON document { "restrictions": [{ "slug": "...", "minAge": 18 }] }.
  // Products in a listed category require a customer age ATTESTATION
  // at checkout (a recorded self-declaration — NOT identity or age
  // verification). The category enum has no "catalog" member, so this
  // rides "general" like meta.* / stores.* above. Default = no
  // restrictions. MUST stay in sync with EMPTY_AGE_RESTRICTIONS_JSON
  // in that module (no import — cycle).
  "catalog.age_restricted_categories": {
    category: "general",
    value: "{\"restrictions\":[]}",
    isPublic: false,
  },
  // Outbound connectors (ADV-25 part 2 — src/connectors/*). Slack /
  // Telegram / Google Sheets fan-out on order + stock lifecycle
  // events, hooked once at the automation producer seam. The category
  // enum has no "connectors" member, so these ride "general" (the
  // settingCategoryForKey fallback for unlisted prefixes, exactly
  // like meta.* above). bot_token is a secret by the suffix rule;
  // webhook_url and service_account_json are credentials too and are
  // treated as secrets via EXACT_SECRET_KEYS in isSecretSettingKey()
  // below. ALL credentials default empty = NOT configured: the
  // channel is skipped / reports NOT_CONFIGURED with the missing keys
  // named, never a fake send. events = comma-separated subset of
  // order.created, order.status_changed, payment.succeeded, stock.low.
  "connectors.slack.enabled": { category: "general", value: "false", isPublic: false },
  "connectors.slack.webhook_url": { category: "general", value: "", isPublic: false },
  "connectors.slack.events": { category: "general", value: "order.created,order.status_changed,payment.succeeded,stock.low", isPublic: false },
  "connectors.telegram.enabled": { category: "general", value: "false", isPublic: false },
  "connectors.telegram.bot_token": { category: "general", value: "", isPublic: false },
  "connectors.telegram.chat_id": { category: "general", value: "", isPublic: false },
  // API base override — for self-hosted Bot API servers / proxies and
  // for tests. The token is appended as /bot<token>/sendMessage, so
  // the token never appears in a stored URL.
  "connectors.telegram.api_base": { category: "general", value: "https://api.telegram.org", isPublic: false },
  "connectors.telegram.events": { category: "general", value: "order.created,order.status_changed,payment.succeeded,stock.low", isPublic: false },
  // Google Sheets fires on order.created ONLY (one appended row per
  // order — a spreadsheet is an order log, not a chat channel), so it
  // has no events key.
  "connectors.sheets.enabled": { category: "general", value: "false", isPublic: false },
  "connectors.sheets.service_account_json": { category: "general", value: "", isPublic: false },
  "connectors.sheets.spreadsheet_id": { category: "general", value: "", isPublic: false },
  "connectors.sheets.sheet_name": { category: "general", value: "Orders", isPublic: false },
  // Maintenance mode (ADV-29 — src/privacy/maintenance.ts): ONE JSON
  // document { enabled, message_bn, message_en }. The storefront gate
  // (middleware -> GET /api/v1/public/site-status) reads it through
  // getSetting(); the parser fails SAFE — a corrupt value means
  // maintenance OFF, never a taken-down store. Edited from
  // Admin > Settings > Privacy. Default: disabled.
  "site.maintenance": {
    category: "general",
    value:
      '{"enabled":false,"message_bn":"সাইটটি এখন রক্ষণাবেক্ষণের জন্য সাময়িকভাবে বন্ধ আছে। অনুগ্রহ করে কিছুক্ষণ পরে আবার চেষ্টা করুন।","message_en":"The store is temporarily closed for maintenance. Please check back shortly."}',
    isPublic: false,
  },
};

/** Env fallback map: setting key -> env var name. No secret value lives here. */
export const SETTING_ENV_FALLBACK: Record<string, string> = {
  "storage.provider": "STORAGE_PROVIDER",
  "storage.cdn_url": "NEXT_PUBLIC_CDN_URL",
  "email.provider": "EMAIL_PROVIDER",
  "email.from_name": "EMAIL_FROM_NAME",
  "email.from_address": "EMAIL_FROM_ADDRESS",
  "sms.provider": "SMS_PROVIDER",
  "sms.sender_id": "SMS_SENDER_ID",
};

const SECRET_KEY_SUFFIXES = ["api_key", "secret", "password", "token", "private_key", "client_secret", "access_key"];

/**
 * Credential keys whose names carry no secret suffix but whose VALUES
 * are credentials (ADV-25): a Slack incoming-webhook URL is a bearer
 * credential by itself, and a Google service-account JSON embeds the
 * account's private key. Both must encrypt at rest and never be
 * returned by a "safe" getter, suffix or not.
 */
const EXACT_SECRET_KEYS = new Set([
  "connectors.slack.webhook_url",
  "connectors.sheets.service_account_json",
]);

export function isSecretSettingKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (EXACT_SECRET_KEYS.has(lower)) return true;
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

import { getCachedValue, setCachedValue, invalidateCacheKey } from "./redis";

export function invalidateSettingCache(key?: string): void {
  invalidateCacheKey(key).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Get / set                                                           */
/* ------------------------------------------------------------------ */

export async function getSetting(key: string): Promise<string | null> {
  const cached = await getCachedValue(key);
  if (cached !== null) return cached;
  const row = await prisma.setting.findUnique({ where: { key } });
  if (row !== null) {
    const value = row.valueEncrypted ? decryptValue(row.value) : row.value;
    await setCachedValue(key, value);
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
      `${category}.${provider}.api_token`,
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
