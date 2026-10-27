"use client";

// Admin > Settings > Tracking — Multi-Pixel, CAPI, Clarity, GA4, TikTok & GTM.
// Fields map to Admin Settings keys (src/tracking/settings.ts contract):
//   POST /api/v1/admin/settings  { key, value, reason }
// Public ids (Meta Pixel, Clarity, GA4, TikTok, GTM) may be shown; the CAPI /
// GA4 / TikTok TOKENS are write-only secrets: password fields, never
// prefilled, never read back — status shows only "Configured / Not
// configured" booleans from GET /api/v1/admin/tracking.
// UI copy: doc-30 dictionary (../strings-b).
import { useEffect, useState } from "react";
import { TRACKING_SETTING_KEYS } from "@/tracking/settings";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { SETTINGS_B_STRINGS, type SettingsBStrings } from "../strings-b";

type SKey = keyof SettingsBStrings;

interface TrackingStatus {
  metaPixelConfigured: boolean;
  metaBackupPixelConfigured?: boolean;
  metaCapiEnabled: boolean;
  metaAccessTokenConfigured: boolean;
  metaBackupAccessTokenConfigured?: boolean;
  ga4Configured: boolean;
  tiktokConfigured: boolean;
  clarityConfigured?: boolean;
}

interface FieldDef { key: string; labelKey: SKey; secret: boolean; placeholder: string; placeholderKey?: SKey }

const META_FIELDS: FieldDef[] = [
  { key: TRACKING_SETTING_KEYS.metaPixelId, labelKey: "trackFLMetaPixel", secret: false, placeholder: "e.g. 123456789012345" },
  { key: TRACKING_SETTING_KEYS.metaCapiEnabled, labelKey: "trackFLMetaCapi", secret: false, placeholder: "false" },
  { key: TRACKING_SETTING_KEYS.metaTestEventCode, labelKey: "trackFLMetaTest", secret: false, placeholder: "TEST12345" },
  { key: TRACKING_SETTING_KEYS.metaAccessToken, labelKey: "trackFLMetaToken", secret: true, placeholder: "", placeholderKey: "trackWriteOnly" },
  { key: TRACKING_SETTING_KEYS.metaBackupPixelId, labelKey: "trackFLBackupPixel", secret: false, placeholder: "e.g. 987654321098765" },
  { key: TRACKING_SETTING_KEYS.metaBackupAccessToken, labelKey: "trackFLBackupToken", secret: true, placeholder: "", placeholderKey: "trackWriteOnly" },
];
const CLARITY_FIELDS: FieldDef[] = [
  { key: TRACKING_SETTING_KEYS.clarityProjectId, labelKey: "trackFLClarity", secret: false, placeholder: "", placeholderKey: "trackFLClarityPh" },
];
const GOOGLE_FIELDS: FieldDef[] = [
  { key: TRACKING_SETTING_KEYS.ga4MeasurementId, labelKey: "trackFLGa4", secret: false, placeholder: "G-XXXXXXXXXX" },
  { key: TRACKING_SETTING_KEYS.ga4ApiSecret, labelKey: "trackFLGa4Secret", secret: true, placeholder: "", placeholderKey: "trackWriteOnly" },
  { key: TRACKING_SETTING_KEYS.gtmContainerId, labelKey: "trackFLGtm", secret: false, placeholder: "GTM-XXXXXXX" },
];
const TIKTOK_FIELDS: FieldDef[] = [
  { key: TRACKING_SETTING_KEYS.tiktokPixelId, labelKey: "trackFLTiktok", secret: false, placeholder: "CXXXXXXXXXXXXXXX" },
  { key: TRACKING_SETTING_KEYS.tiktokAccessToken, labelKey: "trackFLTiktokToken", secret: true, placeholder: "", placeholderKey: "trackWriteOnly" },
];

async function postSetting(key: string, value: string, reason: string, s: SettingsBStrings): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch("/api/v1/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, reason }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!res.ok) return { ok: false, message: data.error?.message ?? interpolate(s.trackSaveFailed, { status: res.status }) };
    return { ok: true, message: s.trackSaved };
  } catch {
    return { ok: false, message: s.trackNetworkError };
  }
}

function FieldRow({ settingKey, labelKey, secret, placeholder, placeholderKey, s }: Omit<FieldDef, "key"> & { settingKey: string; s: SettingsBStrings }) {
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const label = s[labelKey];
  const ph = placeholderKey ? s[placeholderKey] : placeholder;

  const save = async () => {
    if (value.trim() === "") return setStatus(s.trackValueRequired);
    if (reason.trim() === "") return setStatus(s.trackReasonRequired);
    const result = await postSetting(settingKey, value.trim(), reason.trim(), s);
    setStatus(result.message);
    if (result.ok && secret) setValue("");
  };

  return (
    <div style={{ border: "1px solid #E6E8F2", borderRadius: 6, padding: 16, marginBottom: 12, backgroundColor: "#FAFAFC" }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 4px 0" }}>{label}</h3>
      <p style={{ fontSize: 12, color: "#666", margin: "0 0 10px 0" }}>
        {s.trackKeyLabel} <code>{settingKey}</code>
        {secret ? s.trackSecretNote : ""}
      </p>
      <input
        type={secret ? "password" : "text"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={ph}
        autoComplete="off"
        style={{ display: "block", width: "100%", maxWidth: 440, marginBottom: 8, padding: 8, border: "1px solid #D1D5DB", borderRadius: 4 }}
      />
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={s.trackReasonPlaceholder}
        style={{ display: "block", width: "100%", maxWidth: 440, marginBottom: 8, padding: 8, border: "1px solid #D1D5DB", borderRadius: 4 }}
      />
      <button
        type="button"
        onClick={save}
        style={{ padding: "6px 14px", backgroundColor: "#111827", color: "#FFF", borderRadius: 4, cursor: "pointer", border: "none" }}
      >
        {s.save}
      </button>
      {status && <span style={{ marginLeft: 12, fontSize: 13, color: status === s.trackSaved ? "#059669" : "#DC2626" }}>{status}</span>}
    </div>
  );
}

export default function TrackingSettingsPage() {
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_B_STRINGS);
  const [status, setStatus] = useState<TrackingStatus | null>(null);
  const [statusError, setStatusError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/admin/tracking");
        const json = (await res.json().catch(() => ({}))) as { data?: { status?: TrackingStatus }; error?: { message?: string } };
        if (!res.ok) return setStatusError(json.error?.message ?? interpolate(s.trackStatusUnavailable, { status: res.status }));
        setStatus(json.data?.status ?? null);
      } catch {
        setStatusError(s.trackStatusNetwork);
      }
    })();
    // Status copy is resolved at fetch time; locale changes re-render labels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const yn = (v: boolean | undefined) => (v === undefined ? "—" : v ? s.trackConfiguredOn : s.trackNotConfiguredOff);

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>{s.trackTitle}</h1>
      <p style={{ color: "#4B5563", marginBottom: 20 }}>{s.trackDesc}</p>

      <div
        style={{ border: "1px solid #34D399", backgroundColor: "#ECFDF5", color: "#065F46", borderRadius: 8, padding: "12px 16px", marginBottom: 24, fontSize: 14, lineHeight: 1.7 }}
      >
        <strong>✅ {s.trackLiveA}</strong>
        {s.trackLiveBody}
        <code>seo.meta.pixel_id</code>
        {s.trackLiveBody2}
        <code>seo.meta.access_token</code>
        {s.trackLiveBody3}
        <code>NEXT_PUBLIC_META_PIXEL_ID</code>
        {s.trackLiveBody4}
        <code>META_ACCESS_TOKEN</code>
        {s.trackLiveBody5}
      </div>

      <section style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: 18, marginBottom: 24, backgroundColor: "#F9FAFB" }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 10px 0" }}>{s.trackStatusTitle}</h2>
        {statusError && <p style={{ fontSize: 13, color: "#DC2626" }}>{statusError}</p>}
        {status && (
          <ul style={{ fontSize: 14, lineHeight: 2, margin: 0, paddingLeft: 20 }}>
            <li><strong>{s.trackPrimaryPixel}</strong> {yn(status.metaPixelConfigured)}</li>
            <li><strong>{s.trackBackupPixel}</strong> {yn(status.metaBackupPixelConfigured)}</li>
            <li><strong>{s.trackMetaCapi}</strong> {yn(status.metaCapiEnabled)} · {s.trackPrimaryToken} {yn(status.metaAccessTokenConfigured)} · {s.trackBackupToken} {yn(status.metaBackupAccessTokenConfigured)}</li>
            <li><strong>{s.trackClarityStatus}</strong> {yn(status.clarityConfigured)} {s.trackClaritySuffix}</li>
            <li><strong>GA4:</strong> {yn(status.ga4Configured)}</li>
            <li><strong>TikTok:</strong> {yn(status.tiktokConfigured)}</li>
          </ul>
        )}
        {!status && !statusError && <p style={{ fontSize: 13, color: "#6B7280" }}>{s.trackLoadingStatus}</p>}
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, borderBottom: "1px solid #E5E7EB", paddingBottom: 6, marginBottom: 14 }}>
          {s.trackMetaHeading}
        </h2>
        <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 12 }}>{s.trackMetaDesc}</p>
        {META_FIELDS.map((f) => (
          <FieldRow key={f.key} settingKey={f.key} labelKey={f.labelKey} secret={f.secret} placeholder={f.placeholder} placeholderKey={f.placeholderKey} s={s} />
        ))}
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, borderBottom: "1px solid #E5E7EB", paddingBottom: 6, marginBottom: 14 }}>
          {s.trackClarityHeading}
        </h2>
        <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 12 }}>
          {s.trackClarityDesc}
          <code>clarity.microsoft.com</code>
          {s.trackClarityDesc2}
        </p>
        {CLARITY_FIELDS.map((f) => (
          <FieldRow key={f.key} settingKey={f.key} labelKey={f.labelKey} secret={f.secret} placeholder={f.placeholder} placeholderKey={f.placeholderKey} s={s} />
        ))}
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, borderBottom: "1px solid #E5E7EB", paddingBottom: 6, marginBottom: 14 }}>
          {s.trackGoogleHeading}
        </h2>
        {GOOGLE_FIELDS.map((f) => (
          <FieldRow key={f.key} settingKey={f.key} labelKey={f.labelKey} secret={f.secret} placeholder={f.placeholder} placeholderKey={f.placeholderKey} s={s} />
        ))}
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, borderBottom: "1px solid #E5E7EB", paddingBottom: 6, marginBottom: 14 }}>
          {s.trackTiktokHeading}
        </h2>
        {TIKTOK_FIELDS.map((f) => (
          <FieldRow key={f.key} settingKey={f.key} labelKey={f.labelKey} secret={f.secret} placeholder={f.placeholder} placeholderKey={f.placeholderKey} s={s} />
        ))}
      </section>

      <p style={{ fontSize: 12, color: "#9CA3AF" }}>{s.trackFooterNote}</p>
    </main>
  );
}
