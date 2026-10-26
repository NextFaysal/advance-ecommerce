/**
 * Settings-driven bKash resolution — ADV-4 (doc 22). Mirrors the ADV-2
 * SMS resolver (src/integrations/sms-resolver.ts): ONE place builds the
 * live gateway, from an injected settings reader, so no caller ever
 * assembles credentials by hand.
 *
 * bKash counts as CONFIGURED only when ALL of these hold:
 *   - `payment.bkash.mode` is "live" (the admin's mode intent — in
 *     "sandbox" mode the app's simulated sandbox gateway owns bKash,
 *     untouched by this module; see src/payments/initiate.ts);
 *   - `payment.bkash.enabled` is "true";
 *   - every credential field is present in the encrypted Settings
 *     store: username, password, app_key, app_secret
 *     (Settings keys payment.bkash.username / .password / .app_key /
 *     .app_secret; password + app_secret are stored encrypted by the
 *     settings service's secret-suffix rule).
 * Anything less resolves to null and the caller answers honestly
 * not_configured — a live-mode store without complete credentials must
 * never fall back to the simulated checkout.
 *
 * Reader failures degrade to "not configured" — never to a crash and
 * never to a fake live gateway. diagnoseBkash() names the missing
 * FIELD KEYS only (booleans + names, never values) for the initiation
 * message and the Settings connection probe.
 */
import type { PaymentGateway } from "../payment";
import {
  BkashProviderError,
  createBkashClient,
  type BkashAdapterOptions,
  type BkashClient,
  type BkashCredentials,
} from "./client";
import { createBkashGateway } from "./gateway";

export interface BkashSettingsReader {
  /** Effective setting value (DB -> env -> default), or null. */
  getSetting(key: string): Promise<string | null>;
  /** All `payment.<provider>.*` fields, secrets decrypted. Server-side only. */
  getProviderSecrets(provider: string): Promise<Record<string, string>>;
}

export const BKASH_REQUIRED_FIELDS = ["username", "password", "app_key", "app_secret"] as const;

export interface BkashDiagnosis {
  enabled: boolean;
  /** Raw mode value from Settings ("sandbox" unless flipped to "live"). */
  mode: string;
  /** Required credential fields that are absent/empty (names only). */
  missingFields: string[];
  /** enabled && mode === "live" && no missing credential fields. */
  configured: boolean;
}

function fieldValue(fields: Record<string, string>, field: string): string {
  return (fields[field] ?? "").trim();
}

async function safeGet(reader: BkashSettingsReader, key: string): Promise<string | null> {
  try {
    return await reader.getSetting(key);
  } catch {
    return null;
  }
}

async function safeSecrets(reader: BkashSettingsReader): Promise<Record<string, string>> {
  try {
    return await reader.getProviderSecrets("bkash");
  } catch {
    // An undecryptable/unreachable secret store means "not configured"
    // for routing purposes; the Settings probe surfaces the diagnosis
    // (missing fields) through the same lens.
    return {};
  }
}

export async function diagnoseBkash(reader: BkashSettingsReader): Promise<BkashDiagnosis> {
  const enabled = (await safeGet(reader, "payment.bkash.enabled")) === "true";
  const mode = (await safeGet(reader, "payment.bkash.mode")) ?? "sandbox";
  const fields = await safeSecrets(reader);
  const missingFields = BKASH_REQUIRED_FIELDS.filter((f) => fieldValue(fields, f) === "");
  return {
    enabled,
    mode,
    missingFields,
    configured: enabled && mode === "live" && missingFields.length === 0,
  };
}

/** Credentials from the Settings store, or null when any required
 *  field is absent. Values are returned ONLY to server-side adapter
 *  construction — never to a route response. */
export async function loadBkashCredentials(
  reader: BkashSettingsReader,
): Promise<BkashCredentials | null> {
  const fields = await safeSecrets(reader);
  const credentials: BkashCredentials = {
    username: fieldValue(fields, "username"),
    password: fieldValue(fields, "password"),
    appKey: fieldValue(fields, "app_key"),
    appSecret: fieldValue(fields, "app_secret"),
  };
  if (Object.values(credentials).some((v) => v === "")) return null;
  return credentials;
}

/** Build the LIVE bKash gateway when fully configured, else null. */
export async function buildLiveBkashGateway(
  reader: BkashSettingsReader,
  opts: BkashAdapterOptions = {},
): Promise<PaymentGateway | null> {
  const diagnosis = await diagnoseBkash(reader);
  if (!diagnosis.configured) return null;
  const credentials = await loadBkashCredentials(reader);
  if (credentials === null) return null;
  return createBkashGateway(credentials, opts);
}

/**
 * Settings connection probe for bKash (used by the admin settings test
 * route): diagnoses configuration, then — only when credentials are
 * complete — performs a REAL grant-token call against the environment
 * the saved mode selects (bKash sandbox creds against the bKash sandbox
 * host, live creds against production). Returns field NAMES and
 * booleans only; the token itself is discarded, never returned.
 */
export async function probeBkashConnection(
  reader: BkashSettingsReader,
  opts: BkashAdapterOptions = {},
): Promise<
  | { ok: true; mode: string; environment: "live" | "sandbox" }
  | { ok: false; code: string; missingFields: string[]; mode: string; message: string }
> {
  const mode = (await safeGet(reader, "payment.bkash.mode")) ?? "sandbox";
  const credentials = await loadBkashCredentials(reader);
  if (credentials === null) {
    const fields = await safeSecrets(reader);
    const missingFields = BKASH_REQUIRED_FIELDS.filter((f) => fieldValue(fields, f) === "");
    return {
      ok: false,
      code: "BKASH_NOT_CONFIGURED",
      missingFields,
      mode,
      message: `bKash credentials are incomplete in Settings — missing: ${missingFields.map((f) => `payment.bkash.${f}`).join(", ") || "none"}.`,
    };
  }
  const environment = mode === "live" ? "live" : "sandbox";
  const client: BkashClient = createBkashClient(credentials, environment, opts);
  try {
    await client.grantToken();
    return { ok: true, mode, environment };
  } catch (err) {
    if (err instanceof BkashProviderError) {
      return { ok: false, code: err.code, missingFields: [], mode, message: err.message };
    }
    return { ok: false, code: "BKASH_PROBE_FAILED", missingFields: [], mode, message: "bKash connection probe failed unexpectedly." };
  }
}
