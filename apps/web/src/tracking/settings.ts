// Tracking settings contract — Agent 24.
// Keys ride the existing Admin Settings system (src/lib/settings.ts): the
// provider-scoped pattern `seo.<provider>.<field>` already passes
// isKnownSettingKey(), and any key whose suffix is "token" is treated as a
// SECRET there — encrypted (AES-256-GCM) in the DB, never returned by a
// safe getter, never shown in the admin UI. This module holds key NAMES and
// shapes only; no value, token, or pixel id lives in code.
//
// RUNTIME WIRING (ADV-9, doc 21 G3-2): the runtime DOES read these DB
// keys now. src/tracking/resolve.ts resolves every value DB-first (this
// store, via src/lib/settings.ts getSetting()) with the server env as
// fallback: the browser pixel ids reach the storefront through the
// server shell (app/tracking-shell.tsx), and real CAPI sending resolves
// its pixel/token targets through resolveMetaCapi() — so the token CAPI
// sends with is `seo.meta.access_token` from this store when set, else
// META_ACCESS_TOKEN from env. Env applies only where the DB value is
// empty. See src/tracking/resolve.ts for the full resolution order.
export const TRACKING_SETTING_KEYS = {
  metaPixelId: "seo.meta.pixel_id",
  metaBackupPixelId: "seo.meta.backup_pixel_id", // Secondary / Backup Meta Pixel
  metaCapiEnabled: "seo.meta.capi_enabled",
  metaTestEventCode: "seo.meta.test_event_code",
  metaAccessToken: "seo.meta.access_token", // SECRET — encrypted, write-only in UI
  metaBackupAccessToken: "seo.meta.backup_access_token", // SECRET — encrypted, write-only in UI
  ga4MeasurementId: "seo.ga4.measurement_id",
  ga4ApiSecret: "seo.ga4.api_secret", // SECRET — encrypted, write-only in UI
  tiktokPixelId: "seo.tiktok.pixel_id",
  tiktokAccessToken: "seo.tiktok.access_token", // SECRET — encrypted, write-only in UI
  gtmContainerId: "seo.gtm.container_id",
  clarityProjectId: "seo.clarity.project_id", // Microsoft Clarity Project ID
} as const;

export type TrackingSettingKey = (typeof TRACKING_SETTING_KEYS)[keyof typeof TRACKING_SETTING_KEYS];

/** Secret tracking keys: the admin may SET them but can never READ them back. */
export const TRACKING_SECRET_KEYS: readonly string[] = [
  TRACKING_SETTING_KEYS.metaAccessToken,
  TRACKING_SETTING_KEYS.metaBackupAccessToken,
  TRACKING_SETTING_KEYS.ga4ApiSecret,
  TRACKING_SETTING_KEYS.tiktokAccessToken,
];

/**
 * Status view for admin/API responses: booleans + the public ids only.
 * Pixel/measurement ids are public by design (they ship in storefront HTML);
 * tokens are represented by `*Configured` booleans and nothing else.
 */
export interface TrackingConfigStatus {
  metaPixelId: string | null;
  metaPixelConfigured: boolean;
  metaBackupPixelId: string | null;
  metaBackupPixelConfigured: boolean;
  metaCapiEnabled: boolean;
  metaAccessTokenConfigured: boolean;
  metaBackupAccessTokenConfigured: boolean;
  metaTestEventCode: string | null;
  ga4MeasurementId: string | null;
  ga4Configured: boolean;
  tiktokPixelId: string | null;
  tiktokConfigured: boolean;
  gtmContainerId: string | null;
  clarityProjectId: string | null;
  clarityConfigured: boolean;
}

/**
 * All-unconfigured status constant (fail-closed shape: no pixel id and
 * CAPI disabled means the sender seam stays sandbox and no event leaves
 * the server). The live status is resolved by resolveTrackingConfigStatus()
 * in src/tracking/resolve.ts; this constant remains the empty baseline.
 */
export const UNCONFIGURED_TRACKING_STATUS: TrackingConfigStatus = {
  metaPixelId: null,
  metaPixelConfigured: false,
  metaBackupPixelId: null,
  metaBackupPixelConfigured: false,
  metaCapiEnabled: false,
  metaAccessTokenConfigured: false,
  metaBackupAccessTokenConfigured: false,
  metaTestEventCode: null,
  ga4MeasurementId: null,
  ga4Configured: false,
  tiktokPixelId: null,
  tiktokConfigured: false,
  gtmContainerId: null,
  clarityProjectId: null,
  clarityConfigured: false,
};
