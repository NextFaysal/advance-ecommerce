/**
 * Settings-driven Pathao resolution — ADV-5 remainder (doc 22).
 * Mirrors the Steadfast resolver (src/integrations/steadfast-resolver.ts):
 * ONE place builds the live courier adapter, from an injected settings
 * reader, so no caller ever assembles credentials by hand.
 *
 * Pathao counts as CONFIGURED only when BOTH hold:
 *   - `courier.pathao.enabled` is "true" (the admin's on/off intent —
 *     the same gate SMS applies per provider), and
 *   - every required credential field is present in the encrypted
 *     Settings store: client_id, client_secret, username, password,
 *     store_id (Settings keys courier.pathao.* — client_secret and
 *     password are encrypted at rest by the settings service's
 *     secret-suffix rule).
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

export const PATHAO_REQUIRED_FIELDS = [
  "client_id",
  "client_secret",
  "username",
  "password",
  "store_id",
] as const;

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
  const missingFields = PATHAO_REQUIRED_FIELDS.filter((f) => fieldValue(fields, f) === "");
  // store_id must also PARSE as a positive integer — a non-numeric
  // value is as unconfigured as a missing one, and is reported by
  // field NAME (never value) alongside the missing ones.
  const storeRaw = fieldValue(fields, "store_id");
  const storeValid = storeRaw !== "" && Number.isInteger(Number(storeRaw)) && Number(storeRaw) > 0;
  if (!storeValid && !missingFields.includes("store_id")) missingFields.push("store_id");
  return {
    provider: "pathao",
    enabled,
    missingFields,
    configured: enabled && missingFields.length === 0,
  };
}

/** Build the REAL adapter when Pathao is fully configured (enabled +
 *  all credentials), else null. Used by the resolver and by the admin
 *  probe, which must test Pathao itself — never a fallback. */
export async function buildConfiguredPathaoProvider(
  reader: PathaoSettingsReader,
  opts: PathaoAdapterOptions = {},
): Promise<PathaoCourierProvider | null> {
  const diagnosis = await diagnosePathaoCourier(reader);
  if (!diagnosis.configured) return null;
  const fields = await safeSecrets(reader);
  return createPathaoProvider(
    {
      clientId: fieldValue(fields, "client_id"),
      clientSecret: fieldValue(fields, "client_secret"),
      username: fieldValue(fields, "username"),
      password: fieldValue(fields, "password"),
      storeId: Number(fieldValue(fields, "store_id")),
    },
    opts,
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
