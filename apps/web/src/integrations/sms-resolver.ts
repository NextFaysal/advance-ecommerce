/**
 * Settings-driven SMS provider resolution — ADV-2 (doc 22).
 *
 * ONE resolver for every send path: the sms-send job handler chain
 * (worker-deps.ts injects it into the OTP / return-update / call-center
 * automation / back-in-stock processors and the notification-retry
 * runner) and any direct server-side send. Nobody constructs a gateway
 * adapter anywhere else.
 *
 * Resolution contract:
 *   active provider = explicit request ?? `sms.provider` setting ??
 *                     built-in default (bulksmsbd).
 *   A provider counts as CONFIGURED only when BOTH hold:
 *     - `sms.<provider>.enabled` is "true" (the admin's on/off intent —
 *       the same gate payments apply at initiation), and
 *     - every required credential field is present in the encrypted
 *       Settings store:
 *         bulksmsbd:   api_key        (+ sender: sms.bulksmsbd.sender_id
 *                                      ?? sms.sender_id)
 *         sslwireless: api_token, sid
 *         greenweb:    token
 *   When the active provider is not configured but
 *   `sms.fallback_provider` names a different, configured provider,
 *   the fallback is used (viaFallback: true) — this is the
 *   PROVIDER_DOWN_FALLBACK "queue with fallback provider" rule applied
 *   at resolution time. Send-time failover is deliberately NOT done:
 *   a thrown send goes to BullMQ retry / dead-letter, where a failure
 *   is visible, instead of silently re-sending through a second
 *   gateway (double-send risk on ambiguous provider errors).
 *   When nothing is configured this returns null and the CALLER falls
 *   back to the sandbox simulator, whose results stay labelled
 *   simulated (sandbox-sms-… ids, mode "sandbox") — a store without a
 *   gateway account behaves exactly as before ADV-2.
 *
 * The settings store is injected as a reader so this module stays free
 * of the Prisma import (the worker's lazy-settings pattern in
 * worker-deps.ts) and is smoke-testable with a fake reader. Reader
 * failures degrade to "not configured" — never to a crash and never
 * to a fake real send.
 */
import { SMS_PROVIDERS, type SmsProviderName } from "./sms";
import {
  createBulkSmsBdProvider,
  createGreenWebProvider,
  createSslWirelessProvider,
  type SmsAdapterOptions,
  type SmsGatewayProvider,
} from "./sms-providers";

export interface SmsSettingsReader {
  /** Effective setting value (DB -> env -> default), or null. */
  getSetting(key: string): Promise<string | null>;
  /** All `sms.<provider>.*` fields, secrets decrypted. Server-side only. */
  getProviderSecrets(provider: SmsProviderName): Promise<Record<string, string>>;
}

export interface SmsProviderDiagnosis {
  provider: SmsProviderName;
  enabled: boolean;
  /** Required credential fields that are absent/empty. */
  missingFields: string[];
  configured: boolean;
}

export interface ResolvedSmsProvider {
  provider: SmsGatewayProvider;
  providerName: SmsProviderName;
  viaFallback: boolean;
}

const REQUIRED_FIELDS: Record<SmsProviderName, readonly string[]> = {
  bulksmsbd: ["api_key"],
  sslwireless: ["api_token", "sid"],
  greenweb: ["token"],
};

/** Field lookup that accepts the provider's alternate spellings
 *  (sslwireless credentials have been stored as both api_token and
 *  token by different admin tools). */
function fieldValue(fields: Record<string, string>, field: string): string {
  const direct = (fields[field] ?? "").trim();
  if (direct !== "") return direct;
  if (field === "api_token") return (fields.token ?? "").trim();
  if (field === "token") return (fields.api_token ?? "").trim();
  return "";
}

async function safeGet(reader: SmsSettingsReader, key: string): Promise<string | null> {
  try {
    return await reader.getSetting(key);
  } catch {
    return null;
  }
}

async function safeSecrets(
  reader: SmsSettingsReader,
  provider: SmsProviderName,
): Promise<Record<string, string>> {
  try {
    return await reader.getProviderSecrets(provider);
  } catch {
    // An undecryptable/unreachable secret store means "not configured"
    // for routing purposes; the admin balance probe surfaces the real
    // error through its own path.
    return {};
  }
}

export async function diagnoseSmsProvider(
  reader: SmsSettingsReader,
  provider: SmsProviderName,
): Promise<SmsProviderDiagnosis> {
  const enabled = (await safeGet(reader, `sms.${provider}.enabled`)) === "true";
  const fields = await safeSecrets(reader, provider);
  const missingFields = REQUIRED_FIELDS[provider].filter((f) => fieldValue(fields, f) === "");
  return { provider, enabled, missingFields, configured: enabled && missingFields.length === 0 };
}

/** Build the REAL adapter for exactly this provider when it is fully
 *  configured (enabled + all credentials), else null. Used by the
 *  resolver (active/fallback chain) and by the admin balance probe,
 *  which must test the provider it names — never a fallback. */
export async function buildConfiguredSmsProvider(
  reader: SmsSettingsReader,
  provider: SmsProviderName,
  opts: SmsAdapterOptions = {},
): Promise<SmsGatewayProvider | null> {
  const diagnosis = await diagnoseSmsProvider(reader, provider);
  if (!diagnosis.configured) return null;
  const fields = await safeSecrets(reader, provider);
  if (provider === "bulksmsbd") {
    const senderId =
      (fields.sender_id ?? "").trim() || (await safeGet(reader, "sms.sender_id"))?.trim() || null;
    return createBulkSmsBdProvider({ apiKey: fieldValue(fields, "api_key"), senderId }, opts);
  }
  if (provider === "sslwireless") {
    return createSslWirelessProvider(
      { apiToken: fieldValue(fields, "api_token"), sid: fieldValue(fields, "sid") },
      opts,
    );
  }
  return createGreenWebProvider({ token: fieldValue(fields, "token") }, opts);
}

function validName(value: string | null | undefined): SmsProviderName | null {
  if (value != null && (SMS_PROVIDERS as readonly string[]).includes(value)) {
    return value as SmsProviderName;
  }
  return null;
}

export async function resolveConfiguredSmsProvider(
  reader: SmsSettingsReader,
  requestedName?: string | null,
  opts: SmsAdapterOptions = {},
): Promise<ResolvedSmsProvider | null> {
  const active =
    validName(requestedName) ?? validName(await safeGet(reader, "sms.provider")) ?? "bulksmsbd";
  const primary = await buildConfiguredSmsProvider(reader, active, opts);
  if (primary !== null) return { provider: primary, providerName: active, viaFallback: false };

  const fallbackName = validName(await safeGet(reader, "sms.fallback_provider"));
  if (fallbackName !== null && fallbackName !== active) {
    const fallback = await buildConfiguredSmsProvider(reader, fallbackName, opts);
    if (fallback !== null) {
      return { provider: fallback, providerName: fallbackName, viaFallback: true };
    }
  }
  return null;
}
