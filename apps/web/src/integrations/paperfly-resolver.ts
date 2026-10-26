/**
 * Settings-driven Paperfly resolution — ADV-5 completion (doc 22).
 * Mirrors the RedX / Steadfast resolvers
 * (src/integrations/redx-resolver.ts, steadfast-resolver.ts): ONE
 * place builds the live courier adapter, from an injected settings
 * reader, so no caller ever assembles credentials by hand.
 *
 * Paperfly counts as CONFIGURED only when BOTH hold:
 *   - `courier.paperfly.enabled` is "true" (the admin's on/off
 *     intent — the same gate SMS applies per provider), and
 *   - the required credential fields are present in the encrypted
 *     Settings store: username + password + api_key (Settings keys
 *     courier.paperfly.username / .password / .api_key — password
 *     and api_key are encrypted at rest by the settings service's
 *     secret-suffix rule; username is plain config, like Pathao's).
 *   `courier.paperfly.store_name` is OPTIONAL config (the pickup
 *   store name Paperfly shows its rider), read at build time and
 *   passed through — never part of the configured test.
 *
 * When Paperfly is not configured, resolution returns null and the
 * CALLER decides the fallback. NOTE: unlike steadfast/pathao/redx,
 * paperfly has NO sandbox booking provider in this codebase yet —
 * the shipments route answers an honest 422 for an unconfigured
 * paperfly booking instead of simulating one, and worker-deps
 * throws NO_ADAPTER. A store without a Paperfly account simply
 * cannot book Paperfly, and nothing pretends otherwise.
 *
 * The settings store is injected as a reader so this module stays
 * free of the Prisma import (the worker's lazy-settings pattern in
 * worker-deps.ts) and is smoke-testable with a fake reader. Reader
 * failures degrade to "not configured" — never to a crash and never
 * to a fake live adapter. diagnosePaperflyCourier() names the
 * missing FIELD KEYS only (booleans + names, never values) for the
 * Settings connection probe.
 */
import {
  createPaperflyProvider,
  PaperflyProviderError,
  type PaperflyAdapterOptions,
  type PaperflyCourierProvider,
} from "./paperfly";

export interface PaperflySettingsReader {
  /** Effective setting value (DB -> env -> default), or null. */
  getSetting(key: string): Promise<string | null>;
  /** All `courier.paperfly.*` fields, secrets decrypted. Server-side only. */
  getProviderSecrets(provider: string): Promise<Record<string, string>>;
}

export const PAPERFLY_REQUIRED_FIELDS = ["username", "password", "api_key"] as const;

export interface PaperflyDiagnosis {
  provider: "paperfly";
  enabled: boolean;
  /** Required credential fields that are absent/empty (names only). */
  missingFields: string[];
  /** enabled && no missing credential fields. */
  configured: boolean;
}

export interface ResolvedPaperflyCourier {
  provider: PaperflyCourierProvider;
  providerName: "paperfly";
}

function fieldValue(fields: Record<string, string>, field: string): string {
  return (fields[field] ?? "").trim();
}

async function safeGet(reader: PaperflySettingsReader, key: string): Promise<string | null> {
  try {
    return await reader.getSetting(key);
  } catch {
    return null;
  }
}

async function safeSecrets(reader: PaperflySettingsReader): Promise<Record<string, string>> {
  try {
    return await reader.getProviderSecrets("paperfly");
  } catch {
    // An undecryptable/unreachable secret store means "not configured"
    // for routing purposes; the admin probe surfaces the real error
    // through its own path.
    return {};
  }
}

export async function diagnosePaperflyCourier(
  reader: PaperflySettingsReader,
): Promise<PaperflyDiagnosis> {
  const enabled = (await safeGet(reader, "courier.paperfly.enabled")) === "true";
  const fields = await safeSecrets(reader);
  const missingFields = PAPERFLY_REQUIRED_FIELDS.filter((f) => fieldValue(fields, f) === "");
  return {
    provider: "paperfly",
    enabled,
    missingFields,
    configured: enabled && missingFields.length === 0,
  };
}

/** Build the REAL adapter when Paperfly is fully configured (enabled
 *  + credentials), else null. Used by the resolver and by the admin
 *  probe, which must test Paperfly itself — never a fallback. */
export async function buildConfiguredPaperflyProvider(
  reader: PaperflySettingsReader,
  opts: PaperflyAdapterOptions = {},
): Promise<PaperflyCourierProvider | null> {
  const diagnosis = await diagnosePaperflyCourier(reader);
  if (!diagnosis.configured) return null;
  const fields = await safeSecrets(reader);
  return createPaperflyProvider(
    {
      username: fieldValue(fields, "username"),
      password: fieldValue(fields, "password"),
      apiKey: fieldValue(fields, "api_key"),
      storeName: fieldValue(fields, "store_name"),
    },
    opts,
  );
}

/** Resolve the live Paperfly adapter for a book path, or null when
 *  it is not configured (the caller then answers honestly — there is
 *  no sandbox Paperfly booking to fall back to). */
export async function resolvePaperflyCourier(
  reader: PaperflySettingsReader,
  opts: PaperflyAdapterOptions = {},
): Promise<ResolvedPaperflyCourier | null> {
  const provider = await buildConfiguredPaperflyProvider(reader, opts);
  if (provider === null) return null;
  return { provider, providerName: "paperfly" };
}

/* ------------------------------------------------------------------ */
/* Settings connection probe (tracking-read probe — ADV-5)             */
/* ------------------------------------------------------------------ */

export type PaperflyProbeResult =
  | { ok: true; referenceChecked: string; message: string }
  | {
      ok: false;
      code: "PAPERFLY_NOT_CONFIGURED" | "PAPERFLY_PROVIDER_ERROR";
      message: string;
      /** Missing credential field names (configuration failures only). */
      missingFields: string[];
    };

/** Real probe for Admin > Settings "test connection": Paperfly
 *  offers no balance/list endpoint in this integration, so the probe
 *  is a tracking read for a reference that cannot exist, using the
 *  real credential headers. It verifies API reachability + header
 *  acceptance ONLY (a 401/403 fails it) — it does NOT verify order
 *  placement, and the success message says so. Unconfigured -> the
 *  missing pieces are named (field names only); a provider rejection
 *  -> its machine code. No credential value is ever returned. */
export async function probePaperflyConnection(
  reader: PaperflySettingsReader,
  opts: PaperflyAdapterOptions = {},
): Promise<PaperflyProbeResult> {
  const diagnosis = await diagnosePaperflyCourier(reader);
  if (!diagnosis.configured) {
    const reasons: string[] = [];
    if (!diagnosis.enabled) reasons.push(`courier.paperfly.enabled is not "true"`);
    if (diagnosis.missingFields.length > 0) {
      reasons.push(`missing credential field(s): ${diagnosis.missingFields.join(", ")}`);
    }
    return {
      ok: false,
      code: "PAPERFLY_NOT_CONFIGURED",
      message: `paperfly is not configured — ${reasons.join("; ")}.`,
      missingFields: [...diagnosis.missingFields],
    };
  }
  const provider = await buildConfiguredPaperflyProvider(reader, opts);
  if (provider === null) {
    return {
      ok: false,
      code: "PAPERFLY_NOT_CONFIGURED",
      message: "paperfly could not be built from Settings.",
      missingFields: [],
    };
  }
  try {
    const { referenceChecked } = await provider.checkCredentials();
    return {
      ok: true,
      referenceChecked,
      message:
        "Paperfly API reachable and the credential headers were accepted (tracking probe for a non-existent reference; order placement was NOT tested).",
    };
  } catch (e) {
    if (e instanceof PaperflyProviderError) {
      return { ok: false, code: "PAPERFLY_PROVIDER_ERROR", message: e.message, missingFields: [] };
    }
    return {
      ok: false,
      code: "PAPERFLY_PROVIDER_ERROR",
      message: "Paperfly credential check failed unexpectedly.",
      missingFields: [],
    };
  }
}
