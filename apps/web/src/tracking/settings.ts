// Tracking settings contract — Agent 24.
// Keys ride the existing Admin Settings system (src/lib/settings.ts): the
// provider-scoped pattern `seo.<provider>.<field>` already passes
// isKnownSettingKey(), and any key whose suffix is "token" is treated as a
// SECRET there — encrypted (AES-256-GCM) in the DB, never returned by a
// safe getter, never shown in the admin UI. This module holds key NAMES and
// shapes only; no value, token, or pixel id lives in code.
//
// Real CAPI sending reads `seo.meta.access_token` server-side via
// getIntegrationConfigWithSecrets() inside the queue worker — never in a
// route response, never in this module.
export const TRACKING_SETTING_KEYS = {
  metaPixelId: "seo.meta.pixel_id",
  metaCapiEnabled: "seo.meta.capi_enabled",
  metaTestEventCode: "seo.meta.test_event_code",
  metaAccessToken: "seo.meta.access_token", // SECRET — encrypted, write-only in UI
  ga4MeasurementId: "seo.ga4.measurement_id",
  ga4ApiSecret: "seo.ga4.api_secret", // SECRET — encrypted, write-only in UI
  tiktokPixelId: "seo.tiktok.pixel_id",
  tiktokAccessToken: "seo.tiktok.access_token", // SECRET — encrypted, write-only in UI
  gtmContainerId: "seo.gtm.container_id",
} as const;

export type TrackingSettingKey = (typeof TRACKING_SETTING_KEYS)[keyof typeof TRACKING_SETTING_KEYS];

/** Secret tracking keys: the admin may SET them but can never READ them back. */
export const TRACKING_SECRET_KEYS: readonly string[] = [
  TRACKING_SETTING_KEYS.metaAccessToken,
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
  metaCapiEnabled: boolean;
  metaAccessTokenConfigured: boolean;
  metaTestEventCode: string | null;
  ga4MeasurementId: string | null;
  ga4Configured: boolean;
  tiktokPixelId: string | null;
  tiktokConfigured: boolean;
  gtmContainerId: string | null;
}

/**
 * Demo resolver used until the DB-backed settings reader is wired into the
 * tracking routes: everything unconfigured/disabled (fail-closed — with no
 * pixel id and CAPI disabled, the sender seam stays sandbox and no event
 * leaves the server). Swap point: resolve the same shape from
 * src/lib/settings.ts getSetting()/integration status when Prisma lands.
 */
export const UNCONFIGURED_TRACKING_STATUS: TrackingConfigStatus = {
  metaPixelId: null,
  metaPixelConfigured: false,
  metaCapiEnabled: false,
  metaAccessTokenConfigured: false,
  metaTestEventCode: null,
  ga4MeasurementId: null,
  ga4Configured: false,
  tiktokPixelId: null,
  tiktokConfigured: false,
  gtmContainerId: null,
};
