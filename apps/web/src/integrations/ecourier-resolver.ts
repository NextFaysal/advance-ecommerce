/**
 * Settings-driven eCourier resolution — ADV-5 completion (doc 22).
 * Mirrors the RedX / Steadfast resolvers
 * (src/integrations/redx-resolver.ts, steadfast-resolver.ts): ONE
 * place builds the live courier adapter, from an injected settings
 * reader, so no caller ever assembles credentials by hand.
 *
 * eCourier counts as CONFIGURED only when BOTH hold:
 *   - `courier.ecourier.enabled` is "true" (the admin's on/off
 *     intent — the same gate SMS applies per provider), and
 *   - the required fields are present in the encrypted Settings
 *     store: api_key + api_secret + user_id + package_code
 *     (Settings keys courier.ecourier.api_key / .api_secret /
 *     .user_id / .package_code — api_key and api_secret are
 *     encrypted at rest by the settings service's secret-suffix
 *     rule; user_id is the merchant identifier eCourier issues
 *     alongside them, package_code is merchant config: a package
 *     eCourier assigned to this merchant, without which a booking
 *     cannot be placed at all — the same reason Pathao's store_id
 *     is part of its configured test).
 *
 * When eCourier is not configured, resolution returns null and the
 * CALLER decides the fallback. NOTE: unlike steadfast/pathao/redx,
 * ecourier has NO sandbox booking provider in this codebase yet —
 * the shipments route answers an honest 422 for an unconfigured
 * ecourier booking instead of simulating one, and worker-deps
 * throws NO_ADAPTER. A store without an eCourier account simply
 * cannot book eCourier, and nothing pretends otherwise.
 *
 * The settings store is injected as a reader so this module stays
 * free of the Prisma import (the worker's lazy-settings pattern in
 * worker-deps.ts) and is smoke-testable with a fake reader. Reader
 * failures degrade to "not configured" — never to a crash and never
 * to a fake live adapter. diagnoseEcourierCourier() names the
 * missing FIELD KEYS only (booleans + names, never values) for the
 * Settings connection probe.
 */
import {
  createEcourierProvider,
  EcourierProviderError,
  type EcourierAdapterOptions,
  type EcourierCourierProvider,
} from "./ecourier";

export interface EcourierSettingsReader {
  /** Effective setting value (DB -> env -> default), or null. */
  getSetting(key: string): Promise<string | null>;
  /** All `courier.ecourier.*` fields, secrets decrypted. Server-side only. */
  getProviderSecrets(provider: string): Promise<Record<string, string>>;
}

export const ECOURIER_REQUIRED_FIELDS = ["api_key", "api_secret", "user_id", "package_code"] as const;

export interface EcourierDiagnosis {
  provider: "ecourier";
  enabled: boolean;
  /** Required fields that are absent/empty (names only). */
  missingFields: string[];
  /** enabled && no missing fields. */
  configured: boolean;
}

export interface ResolvedEcourierCourier {
  provider: EcourierCourierProvider;
  providerName: "ecourier";
}

function fieldValue(fields: Record<string, string>, field: string): string {
  return (fields[field] ?? "").trim();
}

async function safeGet(reader: EcourierSettingsReader, key: string): Promise<string | null> {
  try {
    return await reader.getSetting(key);
  } catch {
    return null;
  }
}

async function safeSecrets(reader: EcourierSettingsReader): Promise<Record<string, string>> {
  try {
    return await reader.getProviderSecrets("ecourier");
  } catch {
    // An undecryptable/unreachable secret store means "not configured"
    // for routing purposes; the admin probe surfaces the real error
    // through its own path.
    return {};
  }
}

export async function diagnoseEcourierCourier(
  reader: EcourierSettingsReader,
): Promise<EcourierDiagnosis> {
  const enabled = (await safeGet(reader, "courier.ecourier.enabled")) === "true";
  const fields = await safeSecrets(reader);
  const missingFields = ECOURIER_REQUIRED_FIELDS.filter((f) => fieldValue(fields, f) === "");
  return {
    provider: "ecourier",
    enabled,
    missingFields,
    configured: enabled && missingFields.length === 0,
  };
}

/** Build the REAL adapter when eCourier is fully configured (enabled
 *  + credentials + package code), else null. Used by the resolver
 *  and by the admin probe, which must test eCourier itself — never
 *  a fallback. */
export async function buildConfiguredEcourierProvider(
  reader: EcourierSettingsReader,
  opts: EcourierAdapterOptions = {},
): Promise<EcourierCourierProvider | null> {
  const diagnosis = await diagnoseEcourierCourier(reader);
  if (!diagnosis.configured) return null;
  const fields = await safeSecrets(reader);
  return createEcourierProvider(
    {
      apiKey: fieldValue(fields, "api_key"),
      apiSecret: fieldValue(fields, "api_secret"),
      userId: fieldValue(fields, "user_id"),
      packageCode: fieldValue(fields, "package_code"),
    },
    opts,
  );
}

/** Resolve the live eCourier adapter for a book path, or null when
 *  it is not configured (the caller then answers honestly — there
 *  is no sandbox eCourier booking to fall back to). */
export async function resolveEcourierCourier(
  reader: EcourierSettingsReader,
  opts: EcourierAdapterOptions = {},
): Promise<ResolvedEcourierCourier | null> {
  const provider = await buildConfiguredEcourierProvider(reader, opts);
  if (provider === null) return null;
  return { provider, providerName: "ecourier" };
}

/* ------------------------------------------------------------------ */
/* Settings connection probe (real package-list call — ADV-5)          */
/* ------------------------------------------------------------------ */

export type EcourierProbeResult =
  | { ok: true; packageCount: number; message: string }
  | {
      ok: false;
      code: "ECOURIER_NOT_CONFIGURED" | "ECOURIER_PROVIDER_ERROR";
      message: string;
      /** Missing field names (configuration failures only). */
      missingFields: string[];
    };

/** Real probe for Admin > Settings "test connection": the
 *  assigned-package list call against the live API when configured
 *  (the cheapest authenticated call eCourier offers — and the one
 *  whose answer an admin needs anyway, since package_code is one of
 *  the required fields). Unconfigured -> the missing pieces are
 *  named (field names only); a provider rejection -> its machine
 *  code. No credential value is ever returned. */
export async function probeEcourierConnection(
  reader: EcourierSettingsReader,
  opts: EcourierAdapterOptions = {},
): Promise<EcourierProbeResult> {
  const diagnosis = await diagnoseEcourierCourier(reader);
  if (!diagnosis.configured) {
    const reasons: string[] = [];
    if (!diagnosis.enabled) reasons.push(`courier.ecourier.enabled is not "true"`);
    if (diagnosis.missingFields.length > 0) {
      reasons.push(`missing field(s): ${diagnosis.missingFields.join(", ")}`);
    }
    return {
      ok: false,
      code: "ECOURIER_NOT_CONFIGURED",
      message: `ecourier is not configured — ${reasons.join("; ")}.`,
      missingFields: [...diagnosis.missingFields],
    };
  }
  const provider = await buildConfiguredEcourierProvider(reader, opts);
  if (provider === null) {
    return {
      ok: false,
      code: "ECOURIER_NOT_CONFIGURED",
      message: "ecourier could not be built from Settings.",
      missingFields: [],
    };
  }
  try {
    const packages = await provider.listPackages();
    return {
      ok: true,
      packageCount: packages.length,
      message: `eCourier package-list check succeeded (real provider call, ${packages.length} package(s) assigned).`,
    };
  } catch (e) {
    if (e instanceof EcourierProviderError) {
      return { ok: false, code: "ECOURIER_PROVIDER_ERROR", message: e.message, missingFields: [] };
    }
    return {
      ok: false,
      code: "ECOURIER_PROVIDER_ERROR",
      message: "eCourier package-list check failed unexpectedly.",
      missingFields: [],
    };
  }
}
