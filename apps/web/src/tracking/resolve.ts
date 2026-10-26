// Runtime tracking config resolver — ADV-9 (doc 21 G3-2, full fix).
//
// SERVER-ONLY. This module reads Admin Settings through the settings
// service (Prisma + AES-256-GCM decryption), so it must never be imported
// from a client component or from the "@/tracking" barrel (which client
// code can reach). Server callers import it by its direct path,
// "@/tracking/resolve". The values marked SECRET below are returned only
// to server-side senders (CAPI); the browser receives exclusively the
// public ids from resolvePublicTrackingIds(), passed as props by a server
// component (app/tracking-shell.tsx).
//
// Resolution order for every value:
//   1. Admin Settings DB — the `seo.*` keys in TRACKING_SETTING_KEYS,
//      saved from Admin > Settings > Tracking (secrets decrypted there).
//   2. Server env fallback (the pre-ADV-9 behaviour: NEXT_PUBLIC_META_*,
//      META_*, NEXT_PUBLIC_CLARITY_PROJECT_ID, ...).
//   3. null — unconfigured; senders stay in sandbox / no-op mode.
// A DB read failure falls back to env: tracking configuration must never
// break storefront rendering or the intake route.
//
// Caching: the settings service already caches each key in-process for
// 5 minutes (and setSetting invalidates on write); this module memoises
// the assembled config for a further 60s so the root layout pays at most
// a handful of cached lookups per minute per process.
import { getSetting } from "@/lib/settings";
import { TRACKING_SETTING_KEYS, type TrackingConfigStatus } from "./settings";

/** Fully resolved tracking configuration. SECRET fields are server-only. */
export interface ResolvedTrackingConfig {
  metaPixelId: string | null;
  metaBackupPixelId: string | null;
  /** Explicit gate from `seo.meta.capi_enabled`; null = never set. */
  metaCapiEnabled: boolean | null;
  metaTestEventCode: string | null;
  /** SECRET — Meta CAPI access token. Never serialise to the browser. */
  metaAccessToken: string | null;
  /** SECRET — backup pixel CAPI access token. Never serialise. */
  metaBackupAccessToken: string | null;
  ga4MeasurementId: string | null;
  /** SECRET — GA4 Measurement Protocol API secret. Never serialise. */
  ga4ApiSecret: string | null;
  tiktokPixelId: string | null;
  /** SECRET — TikTok Events API access token. Never serialise. */
  tiktokAccessToken: string | null;
  gtmContainerId: string | null;
  clarityProjectId: string | null;
}

/** The only tracking values allowed to cross to the browser. */
export interface PublicTrackingIds {
  metaPixelId: string | null;
  metaBackupPixelId: string | null;
  clarityProjectId: string | null;
  ga4MeasurementId: string | null;
  tiktokPixelId: string | null;
  gtmContainerId: string | null;
}

export interface ResolvedMetaCapiTarget {
  pixelId: string;
  accessToken: string;
  testEventCode?: string | null;
}

export interface ResolvedMetaCapi {
  /** False only when `seo.meta.capi_enabled` is explicitly "false". */
  enabled: boolean;
  testEventCode: string | null;
  targets: ResolvedMetaCapiTarget[];
}

async function dbValue(key: string): Promise<string | null> {
  try {
    const raw = await getSetting(key);
    const value = (raw ?? "").trim();
    return value === "" ? null : value;
  } catch {
    // Settings store unavailable (or undecryptable): env fallback decides.
    return null;
  }
}

function envValue(...names: string[]): string | null {
  for (const name of names) {
    const value = (process.env[name] ?? "").trim();
    if (value !== "") return value;
  }
  return null;
}

async function resolveValue(key: string, ...envNames: string[]): Promise<string | null> {
  return (await dbValue(key)) ?? envValue(...envNames);
}

function parseBool(value: string | null): boolean | null {
  if (value === null) return null;
  const lower = value.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  return null;
}

async function loadTrackingConfig(): Promise<ResolvedTrackingConfig> {
  const [
    metaPixelId,
    metaBackupPixelId,
    capiEnabledRaw,
    metaTestEventCode,
    metaAccessToken,
    metaBackupAccessToken,
    ga4MeasurementId,
    ga4ApiSecret,
    tiktokPixelId,
    tiktokAccessToken,
    gtmContainerId,
    clarityProjectId,
  ] = await Promise.all([
    resolveValue(TRACKING_SETTING_KEYS.metaPixelId, "NEXT_PUBLIC_META_PIXEL_ID", "META_PIXEL_ID"),
    resolveValue(TRACKING_SETTING_KEYS.metaBackupPixelId, "NEXT_PUBLIC_META_BACKUP_PIXEL_ID", "META_BACKUP_PIXEL_ID"),
    dbValue(TRACKING_SETTING_KEYS.metaCapiEnabled),
    resolveValue(TRACKING_SETTING_KEYS.metaTestEventCode, "META_TEST_EVENT_CODE"),
    resolveValue(TRACKING_SETTING_KEYS.metaAccessToken, "META_ACCESS_TOKEN"),
    resolveValue(TRACKING_SETTING_KEYS.metaBackupAccessToken, "META_BACKUP_ACCESS_TOKEN"),
    resolveValue(TRACKING_SETTING_KEYS.ga4MeasurementId, "NEXT_PUBLIC_GA4_MEASUREMENT_ID", "GA4_MEASUREMENT_ID"),
    resolveValue(TRACKING_SETTING_KEYS.ga4ApiSecret, "GA4_API_SECRET"),
    resolveValue(TRACKING_SETTING_KEYS.tiktokPixelId, "NEXT_PUBLIC_TIKTOK_PIXEL_ID", "TIKTOK_PIXEL_ID"),
    resolveValue(TRACKING_SETTING_KEYS.tiktokAccessToken, "TIKTOK_ACCESS_TOKEN"),
    resolveValue(TRACKING_SETTING_KEYS.gtmContainerId, "NEXT_PUBLIC_GTM_CONTAINER_ID", "GTM_CONTAINER_ID"),
    resolveValue(TRACKING_SETTING_KEYS.clarityProjectId, "NEXT_PUBLIC_CLARITY_PROJECT_ID", "CLARITY_PROJECT_ID"),
  ]);
  return {
    metaPixelId,
    metaBackupPixelId,
    metaCapiEnabled: parseBool(capiEnabledRaw),
    metaTestEventCode,
    metaAccessToken,
    metaBackupAccessToken,
    ga4MeasurementId,
    ga4ApiSecret,
    tiktokPixelId,
    tiktokAccessToken,
    gtmContainerId,
    clarityProjectId,
  };
}

const CONFIG_TTL_MS = 60_000;
let cached: { at: number; promise: Promise<ResolvedTrackingConfig> } | null = null;

/**
 * The full resolved config (DB first, env fallback), memoised for 60s.
 * SERVER-ONLY — the result contains access tokens.
 */
export function resolveTrackingConfig(): Promise<ResolvedTrackingConfig> {
  const now = Date.now();
  if (cached !== null && now - cached.at < CONFIG_TTL_MS) return cached.promise;
  const promise = loadTrackingConfig();
  cached = { at: now, promise };
  return promise;
}

/** Drop the memoised config (admin writes also invalidate per-key in the
 *  settings service; this exists for tests and ops). */
export function invalidateTrackingConfigCache(): void {
  cached = null;
}

/** Public ids only — the complete set allowed to reach the browser. */
export async function resolvePublicTrackingIds(): Promise<PublicTrackingIds> {
  const config = await resolveTrackingConfig();
  return {
    metaPixelId: config.metaPixelId,
    metaBackupPixelId: config.metaBackupPixelId,
    clarityProjectId: config.clarityProjectId,
    ga4MeasurementId: config.ga4MeasurementId,
    tiktokPixelId: config.tiktokPixelId,
    gtmContainerId: config.gtmContainerId,
  };
}

/**
 * Meta CAPI resolution: a target exists when a pixel id AND its access
 * token both resolve (same pairing rule as the pre-ADV-9 env-only code).
 * `seo.meta.capi_enabled = "false"` in Admin Settings disables CAPI even
 * when tokens exist; unset/"true" leaves the pairing rule in charge.
 */
export async function resolveMetaCapi(): Promise<ResolvedMetaCapi> {
  const config = await resolveTrackingConfig();
  const targets: ResolvedMetaCapiTarget[] = [];
  if (config.metaCapiEnabled !== false) {
    if (config.metaPixelId !== null && config.metaAccessToken !== null) {
      targets.push({
        pixelId: config.metaPixelId,
        accessToken: config.metaAccessToken,
        testEventCode: config.metaTestEventCode,
      });
    }
    if (config.metaBackupPixelId !== null && config.metaBackupAccessToken !== null) {
      targets.push({
        pixelId: config.metaBackupPixelId,
        accessToken: config.metaBackupAccessToken,
        testEventCode: config.metaTestEventCode,
      });
    }
  }
  return {
    enabled: config.metaCapiEnabled !== false,
    testEventCode: config.metaTestEventCode,
    targets,
  };
}

/**
 * Admin status view over the RESOLVED config: public ids + booleans only.
 * Tokens appear solely as `*Configured` booleans — same contract as before,
 * now truthful (it previously hard-coded UNCONFIGURED).
 */
export async function resolveTrackingConfigStatus(): Promise<TrackingConfigStatus> {
  const config = await resolveTrackingConfig();
  const capi = await resolveMetaCapi();
  return {
    metaPixelId: config.metaPixelId,
    metaPixelConfigured: config.metaPixelId !== null,
    metaBackupPixelId: config.metaBackupPixelId,
    metaBackupPixelConfigured: config.metaBackupPixelId !== null,
    metaCapiEnabled: capi.targets.length > 0,
    metaAccessTokenConfigured: config.metaAccessToken !== null,
    metaBackupAccessTokenConfigured: config.metaBackupAccessToken !== null,
    metaTestEventCode: config.metaTestEventCode,
    ga4MeasurementId: config.ga4MeasurementId,
    ga4Configured: config.ga4MeasurementId !== null && config.ga4ApiSecret !== null,
    tiktokPixelId: config.tiktokPixelId,
    tiktokConfigured: config.tiktokPixelId !== null && config.tiktokAccessToken !== null,
    gtmContainerId: config.gtmContainerId,
    clarityProjectId: config.clarityProjectId,
    clarityConfigured: config.clarityProjectId !== null,
  };
}
