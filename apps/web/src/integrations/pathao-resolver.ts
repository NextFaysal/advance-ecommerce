/**
 * Settings-driven Pathao resolution — ADV-5 remainder (doc 22).
 * Mirrors the Steadfast resolver (src/integrations/steadfast-resolver.ts):
 * ONE place builds the live courier adapter, from an injected settings
 * reader, so no caller ever assembles credentials by hand.
 *
 * Pathao counts as CONFIGURED only when BOTH hold:
 *   - `courier.pathao.enabled` is "true" (the admin's on/off intent —
 *     the same gate SMS applies per provider), and
 *   - the required credential pair is present in the encrypted
 *     Settings store: client_id + client_secret (Settings keys
 *     courier.pathao.* — client_secret is encrypted at rest by the
 *     settings service's secret-suffix rule).
 *
 * OPTIONAL fields (never blocking): username + password (when both
 * are present the adapter uses the OAuth password grant; otherwise
 * the token is issued with client_id + client_secret only — the flow
 * Pathao's official plugin uses), store_id (when absent, or not a
 * positive integer, the adapter resolves the merchant's default
 * store from the API at booking time), and base_url (an API host
 * override, passed through like the payment resolvers' api_base_url).
 *
 * When Pathao is not configured, resolution returns null and the
 * CALLER falls back to the sandbox provider, whose bookings stay
 * SBX-prefixed and labelled sandbox (meta.sandbox: true) — a store
 * without a courier account behaves exactly as before this slice.
 *
 * The settings store is injected as a reader so this module stays free
 * of the Prisma import (the worker's lazy-settings pattern in
 * worker-deps.ts) and is smoke-testable with a fake reader. Reader
 * failures degrade to "not configured" — never to a crash and never
 * to a fake live adapter. diagnosePathaoCourier() names the missing
 * FIELD KEYS only (booleans + names, never values) for the Settings
 * connection probe.
 */
import {
  createPathaoProvider,
  PathaoProviderError,
  type PathaoAdapterOptions,
  type PathaoCourierProvider,
} from "./pathao";

export interface PathaoSettingsReader {
  /** Effective setting value (DB -> env -> default), or null. */
  getSetting(key: string): Promise<string | null>;
  /** All `courier.pathao.*` fields, secrets decrypted. Server-side only. */
  getProviderSecrets(provider: string): Promise<Record<string, string>>;
}

export const PATHAO_REQUIRED_FIELDS = ["client_id", "client_secret"] as const;

export interface PathaoDiagnosis {
  provider: "pathao";
  enabled: boolean;
  /** Required credential fields that are absent/empty (names only). */
  missingFields: string[];
  /** enabled && no missing credential fields. */
  configured: boolean;
}

export interface ResolvedPathaoCourier {
  provider: PathaoCourierProvider;
  providerName: "pathao";
}

function fieldValue(fields: Record<string, string>, field: string): string {
  return (fields[field] ?? "").trim();
}

async function safeGet(reader: PathaoSettingsReader, key: string): Promise<string | null> {
  try {
    return await reader.getSetting(key);
  } catch {
    return null;
  }
}

async function safeSecrets(reader: PathaoSettingsReader): Promise<Record<string, string>> {
  try {
    return await reader.getProviderSecrets("pathao");
  } catch {
    // An undecryptable/unreachable secret store means "not configured"
    // for routing purposes; the admin probe surfaces the real error
    // through its own path.
    return {};
  }
}

export async function diagnosePathaoCourier(
  reader: PathaoSettingsReader,
): Promise<PathaoDiagnosis> {
  const enabled = (await safeGet(reader, "courier.pathao.enabled")) === "true";
  const fields = await safeSecrets(reader);
  // Only the client_id + client_secret pair is required; username /
  // password / store_id / base_url are optional and never appear
  // here (see the header note).
  const missingFields = PATHAO_REQUIRED_FIELDS.filter((f) => fieldValue(fields, f) === "");
  return {
    provider: "pathao",
    enabled,
    missingFields,
    configured: enabled && missingFields.length === 0,
  };
}

/** Build the REAL adapter when Pathao is fully configured (enabled +
 *  the required credential pair), else null. Used by the resolver and
 *  by the admin probe, which must test Pathao itself — never a
 *  fallback. */
export async function buildConfiguredPathaoProvider(
  reader: PathaoSettingsReader,
  opts: PathaoAdapterOptions = {},
): Promise<PathaoCourierProvider | null> {
  const diagnosis = await diagnosePathaoCourier(reader);
  if (!diagnosis.configured) return null;
  const fields = await safeSecrets(reader);
  const optional = (field: string): string | undefined => {
    const value = fieldValue(fields, field);
    return value === "" ? undefined : value;
  };
  // store_id is optional: a value that does not parse as a positive
  // integer counts as unset (null) and the adapter resolves the
  // merchant's default store from the API at booking time — it never
  // blocks configuration.
  const storeRaw = fieldValue(fields, "store_id");
  const storeParsed = Number(storeRaw);
  const storeId =
    storeRaw !== "" && Number.isInteger(storeParsed) && storeParsed > 0 ? storeParsed : null;
  return createPathaoProvider(
    {
      clientId: fieldValue(fields, "client_id"),
      clientSecret: fieldValue(fields, "client_secret"),
      username: fieldValue(fields, "username"),
      password: fieldValue(fields, "password"),
      storeId,
    },
    // base_url rides opts like the payment resolvers' api_base_url;
    // a caller-passed opts.baseUrl (spread after) wins over Settings.
    { baseUrl: optional("base_url"), ...opts },
  );
}

/** Resolve the live Pathao adapter for a book path, or null when it is
 *  not configured (the caller then uses the sandbox provider,
 *  labelled sandbox). */
export async function resolvePathaoCourier(
  reader: PathaoSettingsReader,
  opts: PathaoAdapterOptions = {},
): Promise<ResolvedPathaoCourier | null> {
  const provider = await buildConfiguredPathaoProvider(reader, opts);
  if (provider === null) return null;
  return { provider, providerName: "pathao" };
}

/* ------------------------------------------------------------------ */
/* Settings connection probe (real token + stores call — ADV-5)        */
/* ------------------------------------------------------------------ */

export type PathaoProbeResult =
  | { ok: true; storeCount: number; message: string }
  | {
      ok: false;
      code: "PATHAO_NOT_CONFIGURED" | "PATHAO_PROVIDER_ERROR";
      message: string;
      /** Missing credential field names (configuration failures only). */
      missingFields: string[];
    };

/** Real probe for Admin > Settings "test connection": an OAuth token
 *  grant + stores list against the live API when configured (the
 *  cheapest authenticated calls Pathao offers). Unconfigured -> the
 *  missing pieces are named (field names only); a provider rejection
 *  -> its machine code. No credential or token value is ever returned. */
export async function probePathaoConnection(
  reader: PathaoSettingsReader,
  opts: PathaoAdapterOptions = {},
): Promise<PathaoProbeResult> {
  const diagnosis = await diagnosePathaoCourier(reader);
  if (!diagnosis.configured) {
    const reasons: string[] = [];
    if (!diagnosis.enabled) reasons.push(`courier.pathao.enabled is not "true"`);
    if (diagnosis.missingFields.length > 0) {
      reasons.push(`missing credential field(s): ${diagnosis.missingFields.join(", ")}`);
    }
    return {
      ok: false,
      code: "PATHAO_NOT_CONFIGURED",
      message: `pathao is not configured — ${reasons.join("; ")}.`,
      missingFields: [...diagnosis.missingFields],
    };
  }
  const provider = await buildConfiguredPathaoProvider(reader, opts);
  if (provider === null) {
    return {
      ok: false,
      code: "PATHAO_NOT_CONFIGURED",
      message: "pathao could not be built from Settings.",
      missingFields: [],
    };
  }
  try {
    const stores = await provider.listStores();
    return {
      ok: true,
      storeCount: stores.length,
      message: `Pathao token grant + stores check succeeded (real provider call; token discarded, ${stores.length} store(s) visible).`,
    };
  } catch (e) {
    if (e instanceof PathaoProviderError) {
      return { ok: false, code: "PATHAO_PROVIDER_ERROR", message: e.message, missingFields: [] };
    }
    return {
      ok: false,
      code: "PATHAO_PROVIDER_ERROR",
      message: "Pathao stores check failed unexpectedly.",
      missingFields: [],
    };
  }
}
