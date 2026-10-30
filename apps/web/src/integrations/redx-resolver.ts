/**
 * Settings-driven RedX resolution — ADV-5 remainder (doc 22).
 * Mirrors the Steadfast resolver (src/integrations/steadfast-resolver.ts):
 * ONE place builds the live courier adapter, from an injected settings
 * reader, so no caller ever assembles credentials by hand.
 *
 * RedX counts as CONFIGURED only when BOTH hold:
 *   - `courier.redx.enabled` is "true" (the admin's on/off intent —
 *     the same gate SMS applies per provider), and
 *   - the required credential field is present in the encrypted
 *     Settings store: access_token (Settings key
 *     courier.redx.access_token — encrypted at rest by the settings
 *     service's secret-suffix rule).
 *
 * When RedX is not configured, resolution returns null and the CALLER
 * falls back to the sandbox provider, whose bookings stay SBX-prefixed
 * and labelled sandbox (meta.sandbox: true) — a store without a
 * courier account behaves exactly as before this slice.
 *
 * OPTIONAL host override: `courier.redx.base_url` (a plain, non-secret
 * Setting) replaces the adapter's default API base when it holds a
 * valid http(s) URL. RedX publishes no official public API docs, so
 * the shipped default base rests on third-party consensus (see the
 * provenance note in redx.ts); this override lets a merchant point
 * the adapter at the host their merchant panel documents — or at the
 * sandbox host — without a code change. An absent/blank/invalid value
 * is ignored and the default (or a caller-supplied baseUrl) applies.
 *
 * The settings store is injected as a reader so this module stays free
 * of the Prisma import (the worker's lazy-settings pattern in
 * worker-deps.ts) and is smoke-testable with a fake reader. Reader
 * failures degrade to "not configured" — never to a crash and never
 * to a fake live adapter. diagnoseRedxCourier() names the missing
 * FIELD KEYS only (booleans + names, never values) for the Settings
 * connection probe.
 */
import {
  createRedxProvider,
  RedxProviderError,
  type RedxAdapterOptions,
  type RedxCourierProvider,
} from "./redx";

export interface RedxSettingsReader {
  /** Effective setting value (DB -> env -> default), or null. */
  getSetting(key: string): Promise<string | null>;
  /** All `courier.redx.*` fields, secrets decrypted. Server-side only. */
  getProviderSecrets(provider: string): Promise<Record<string, string>>;
}

export const REDX_REQUIRED_FIELDS = ["access_token"] as const;

export interface RedxDiagnosis {
  provider: "redx";
  enabled: boolean;
  /** Required credential fields that are absent/empty (names only). */
  missingFields: string[];
  /** enabled && no missing credential fields. */
  configured: boolean;
}

export interface ResolvedRedxCourier {
  provider: RedxCourierProvider;
  providerName: "redx";
}

function fieldValue(fields: Record<string, string>, field: string): string {
  return (fields[field] ?? "").trim();
}

/** The optional courier.redx.base_url Setting as a usable override:
 *  the trimmed value when it is an http(s) URL, else undefined (the
 *  adapter default / caller option then applies). Never throws — a
 *  malformed override must not take live booking down with it. */
function settingsBaseUrl(raw: string | null): string | undefined {
  if (raw === null) return undefined;
  const value = raw.trim();
  if (value === "" || !/^https?:\/\//i.test(value)) return undefined;
  return value;
}

async function safeGet(reader: RedxSettingsReader, key: string): Promise<string | null> {
  try {
    return await reader.getSetting(key);
  } catch {
    return null;
  }
}

async function safeSecrets(reader: RedxSettingsReader): Promise<Record<string, string>> {
  try {
    return await reader.getProviderSecrets("redx");
  } catch {
    // An undecryptable/unreachable secret store means "not configured"
    // for routing purposes; the admin probe surfaces the real error
    // through its own path.
    return {};
  }
}

export async function diagnoseRedxCourier(reader: RedxSettingsReader): Promise<RedxDiagnosis> {
  const enabled = (await safeGet(reader, "courier.redx.enabled")) === "true";
  const fields = await safeSecrets(reader);
  const missingFields = REDX_REQUIRED_FIELDS.filter((f) => fieldValue(fields, f) === "");
  return {
    provider: "redx",
    enabled,
    missingFields,
    configured: enabled && missingFields.length === 0,
  };
}

/** Build the REAL adapter when RedX is fully configured (enabled +
 *  credential), else null. Used by the resolver and by the admin
 *  probe, which must test RedX itself — never a fallback. */
export async function buildConfiguredRedxProvider(
  reader: RedxSettingsReader,
  opts: RedxAdapterOptions = {},
): Promise<RedxCourierProvider | null> {
  const diagnosis = await diagnoseRedxCourier(reader);
  if (!diagnosis.configured) return null;
  const fields = await safeSecrets(reader);
  // The merchant-facing host override (courier.redx.base_url) wins
  // over a caller-supplied baseUrl: correcting the host from the
  // panel is exactly what the Setting exists for.
  const baseUrl = settingsBaseUrl(await safeGet(reader, "courier.redx.base_url"));
  const effectiveOpts = baseUrl !== undefined ? { ...opts, baseUrl } : opts;
  return createRedxProvider({ accessToken: fieldValue(fields, "access_token") }, effectiveOpts);
}

/** Resolve the live RedX adapter for a book path, or null when it is
 *  not configured (the caller then uses the sandbox provider,
 *  labelled sandbox). */
export async function resolveRedxCourier(
  reader: RedxSettingsReader,
  opts: RedxAdapterOptions = {},
): Promise<ResolvedRedxCourier | null> {
  const provider = await buildConfiguredRedxProvider(reader, opts);
  if (provider === null) return null;
  return { provider, providerName: "redx" };
}

/* ------------------------------------------------------------------ */
/* Settings connection probe (real areas call — ADV-5)                 */
/* ------------------------------------------------------------------ */

export type RedxProbeResult =
  | { ok: true; areaCount: number; message: string }
  | {
      ok: false;
      code: "REDX_NOT_CONFIGURED" | "REDX_PROVIDER_ERROR";
      message: string;
      /** Missing credential field names (configuration failures only). */
      missingFields: string[];
    };

/** Real probe for Admin > Settings "test connection": a delivery-area
 *  list call against the live API when configured (the cheapest
 *  authenticated GET RedX offers). Unconfigured -> the missing pieces
 *  are named (field names only); a provider rejection -> its machine
 *  code. No credential value is ever returned. */
export async function probeRedxConnection(
  reader: RedxSettingsReader,
  opts: RedxAdapterOptions = {},
): Promise<RedxProbeResult> {
  const diagnosis = await diagnoseRedxCourier(reader);
  if (!diagnosis.configured) {
    const reasons: string[] = [];
    if (!diagnosis.enabled) reasons.push(`courier.redx.enabled is not "true"`);
    if (diagnosis.missingFields.length > 0) {
      reasons.push(`missing credential field(s): ${diagnosis.missingFields.join(", ")}`);
    }
    return {
      ok: false,
      code: "REDX_NOT_CONFIGURED",
      message: `redx is not configured — ${reasons.join("; ")}.`,
      missingFields: [...diagnosis.missingFields],
    };
  }
  const provider = await buildConfiguredRedxProvider(reader, opts);
  if (provider === null) {
    return {
      ok: false,
      code: "REDX_NOT_CONFIGURED",
      message: "redx could not be built from Settings.",
      missingFields: [],
    };
  }
  try {
    const areas = await provider.listAreas();
    return {
      ok: true,
      areaCount: areas.length,
      message: `RedX delivery-area check succeeded (real provider call, ${areas.length} area(s) served).`,
    };
  } catch (e) {
    if (e instanceof RedxProviderError) {
      return { ok: false, code: "REDX_PROVIDER_ERROR", message: e.message, missingFields: [] };
    }
    return {
      ok: false,
      code: "REDX_PROVIDER_ERROR",
      message: "RedX delivery-area check failed unexpectedly.",
      missingFields: [],
    };
  }
}
