// Admin-configurable settings resolution — Agent 5 (base only).
// Priority: admin Settings row (DB, encrypted if secret) > env default > built-in default.
// This file contains no credential values and no DB access; Step 7's settings service
// implements the lookup against the settings table. Zod schemas validate admin input.
import { z } from "zod";

export const providerSettingsSchema = z.object({
  provider: z.string().min(1),
  enabled: z.boolean(),
  mode: z.enum(["sandbox", "live"]),
  /** Credential fields arrive as references/placeholders, never as echoed secrets. */
  credentialRef: z.string().nullable(),
});

export type ProviderSettingsInput = z.infer<typeof providerSettingsSchema>;

/** Setting keys (category.key) for the integrations owned by Agent 5. */
export const INTEGRATION_SETTING_KEYS = [
  "payment.bkash.enabled",
  "payment.nagad.enabled",
  "payment.sslcommerz.enabled",
  "payment.aamarpay.enabled",
  "payment.shurjopay.enabled",
  "payment.cod.enabled",
  "courier.steadfast.enabled",
  "courier.pathao.enabled",
  "courier.redx.enabled",
  "courier.paperfly.enabled",
  "courier.ecourier.enabled",
  "sms.provider",
  "sms.fallback_provider",
  "sms.sender_id",
  "email.provider",
  "email.from",
  "storage.provider",
  "storage.bucket",
  "storage.cdn_url",
] as const;

export type IntegrationSettingKey = (typeof INTEGRATION_SETTING_KEYS)[number];

/** Queue + manual fallback rule for a down provider (payment/courier/SMS). */
export const PROVIDER_DOWN_FALLBACK = {
  payment: "Queue the callback/booking, auto-retry with backoff, show manual verify (TrxID) in admin.",
  courier: "Queue the booking, auto-retry, allow manual booking + manual tracking ID entry in admin.",
  sms: "Queue with fallback provider; if both fail, queue for retry and show delivery log in admin.",
  email: "Queue with retry; failed sends appear in the notification delivery log, never silently dropped.",
} as const;
