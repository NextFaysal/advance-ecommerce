/**
 * Settings-driven Steadfast resolution — ADV-5 part 1 (doc 22).
 * Mirrors the ADV-2 SMS resolver (src/integrations/sms-resolver.ts) and
 * the ADV-4 bKash resolver: ONE place builds the live courier adapter,
 * from an injected settings reader, so no caller ever assembles
 * credentials by hand.
 *
 * Steadfast counts as CONFIGURED only when BOTH hold:
 *   - `courier.steadfast.enabled` is "true" (the admin's on/off intent —
 *     the same gate SMS applies per provider), and
 *   - every required credential field is present in the encrypted
 *     Settings store: api_key, secret_key
 *     (Settings keys courier.steadfast.api_key / .secret_key — both are
 *     encrypted at rest by the settings service's secret-suffix rule).
 *
 * When Steadfast is not configured, resolution returns null and the
 * CALLER falls back to the sandbox provider, whose bookings stay
 * SBX-prefixed and labelled sandbox (meta.sandbox: true) — a store
 * without a courier account behaves exactly as before ADV-5.
 *
 * The settings store is injected as a reader so this module stays free
 * of the Prisma import (the worker's lazy-settings pattern in
 * worker-deps.ts) and is smoke-testable with a fake reader. Reader
 * failures degrade to "not configured" — never to a crash and never
 * to a fake live adapter. diagnoseSteadfastCourier() names the missing
 * FIELD KEYS only (booleans + names, never values) for the Settings
 * connection probe.
 *
 * Optional: `courier.steadfast.base_url` overrides the API base URL
 * (the adapter's default host is doc-unverified — see the steadfast.ts
 * header). Only an http(s) value is honoured; anything else is ignored
 * and the adapter default stands. An explicit opts.baseUrl (tests /
 * probes) wins over the Settings value.
 */
import {
  createSteadfastProvider,
  SteadfastProviderError,
  type SteadfastAdapterOptions,
  type SteadfastCourierProvider,
} from "./steadfast";

export interface SteadfastSettingsReader {
  /** Effective setting value (DB -> env -> default), or null. */
  getSetting(key: string): Promise<string | null>;
  /** All `courier.steadfast.*` fields, secrets decrypted. Server-side only. */
  getProviderSecrets(provider: string): Promise<Record<string, string>>;
}

export const STEADFAST_REQUIRED_FIELDS = ["api_key", "secret_key"] as const;

export interface SteadfastDiagnosis {
  provider: "steadfast";
  enabled: boolean;
  /** Required credential fields that are absent/empty (names only). */
  missingFields: string[];
  /** enabled && no missing credential fields. */
  configured: boolean;
}

export interface ResolvedSteadfastCourier {
  provider: SteadfastCourierProvider;
  providerName: "steadfast";
}

function fieldValue(fields: Record<string, string>, field: string): string {
  return (fields[field] ?? "").trim();
}

async function safeGet(reader: SteadfastSettingsReader, key: string): Promise<string | null> {
  try {
    return await reader.getSetting(key);
  } catch {
    return null;
  }
}

async function safeSecrets(reader: SteadfastSettingsReader): Promise<Record<string, string>> {
  try {
    return await reader.getProviderSecrets("steadfast");
  } catch {
    // An undecryptable/unreachable secret store means "not configured"
    // for routing purposes; the admin balance probe surfaces the real
    // error through its own path.
    return {};
  }
}

export async function diagnoseSteadfastCourier(
  reader: SteadfastSettingsReader,
): Promise<SteadfastDiagnosis> {
  const enabled = (await safeGet(reader, "courier.steadfast.enabled")) === "true";
  const fields = await safeSecrets(reader);
  const missingFields = STEADFAST_REQUIRED_FIELDS.filter((f) => fieldValue(fields, f) === "");
  return {
    provider: "steadfast",
    enabled,
    missingFields,
    configured: enabled && missingFields.length === 0,
  };
}

/** Build the REAL adapter when Steadfast is fully configured (enabled +
 *  all credentials), else null. Used by the resolver and by the admin
 *  balance probe, which must test Steadfast itself — never a fallback. */
export async function buildConfiguredSteadfastProvider(
  reader: SteadfastSettingsReader,
  opts: SteadfastAdapterOptions = {},
): Promise<SteadfastCourierProvider | null> {
  const diagnosis = await diagnoseSteadfastCourier(reader);
  if (!diagnosis.configured) return null;
  const fields = await safeSecrets(reader);
  const baseUrlSetting = fieldValue(fields, "base_url");
  const baseUrl = /^https?:\/\//i.test(baseUrlSetting) ? baseUrlSetting : undefined;
  return createSteadfastProvider(
    { apiKey: fieldValue(fields, "api_key"), secretKey: fieldValue(fields, "secret_key") },
    // Settings base_url first so an explicit opts.baseUrl overrides it.
    { ...(baseUrl !== undefined ? { baseUrl } : {}), ...opts },
  );
}

/** Resolve the live Steadfast adapter for a send/book path, or null
 *  when it is not configured (the caller then uses the sandbox
 *  provider, labelled sandbox). */
export async function resolveSteadfastCourier(
  reader: SteadfastSettingsReader,
  opts: SteadfastAdapterOptions = {},
): Promise<ResolvedSteadfastCourier | null> {
  const provider = await buildConfiguredSteadfastProvider(reader, opts);
  if (provider === null) return null;
  return { provider, providerName: "steadfast" };
}

/* ------------------------------------------------------------------ */
/* Settings connection probe (real balance call — ADV-5)               */
/* ------------------------------------------------------------------ */

export type SteadfastProbeResult =
  | { ok: true; balancePoisha: number; currency: "BDT"; message: string }
  | {
      ok: false;
      code: "STEADFAST_NOT_CONFIGURED" | "STEADFAST_PROVIDER_ERROR";
      message: string;
      /** Missing credential field names (configuration failures only). */
      missingFields: string[];
    };

/** Real probe for Admin > Settings "test connection": a balance call
 *  against the live API when configured (the cheapest authenticated
 *  GET Steadfast offers). Unconfigured -> the missing pieces are named
 *  (field names only); a provider rejection -> its machine code. No
 *  credential value is ever returned. */
export async function probeSteadfastConnection(
  reader: SteadfastSettingsReader,
  opts: SteadfastAdapterOptions = {},
): Promise<SteadfastProbeResult> {
  const diagnosis = await diagnoseSteadfastCourier(reader);
  if (!diagnosis.configured) {
    const reasons: string[] = [];
    if (!diagnosis.enabled) reasons.push(`courier.steadfast.enabled is not "true"`);
    if (diagnosis.missingFields.length > 0) {
      reasons.push(`missing credential field(s): ${diagnosis.missingFields.join(", ")}`);
    }
    return {
      ok: false,
      code: "STEADFAST_NOT_CONFIGURED",
      message: `steadfast is not configured — ${reasons.join("; ")}.`,
      missingFields: [...diagnosis.missingFields],
    };
  }
  const provider = await buildConfiguredSteadfastProvider(reader, opts);
  if (provider === null) {
    return {
      ok: false,
      code: "STEADFAST_NOT_CONFIGURED",
      message: "steadfast could not be built from Settings.",
      missingFields: [],
    };
  }
  try {
    const balance = await provider.getBalance();
    return {
      ok: true,
      balancePoisha: balance.balancePoisha,
      currency: balance.currency,
      message: "Steadfast balance check succeeded (real provider call).",
    };
  } catch (e) {
    if (e instanceof SteadfastProviderError) {
      return { ok: false, code: "STEADFAST_PROVIDER_ERROR", message: e.message, missingFields: [] };
    }
    return {
      ok: false,
      code: "STEADFAST_PROVIDER_ERROR",
      message: "Steadfast balance check failed unexpectedly.",
      missingFields: [],
    };
  }
}
