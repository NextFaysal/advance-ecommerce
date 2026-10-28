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
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

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

  const fieldInputCls =
    "mb-2 block w-full max-w-[440px] rounded-xl border border-input bg-background px-3 py-2 text-sm text-text-main shadow-xs focus:border-ring focus:outline-none";
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
      <h3 className="text-sm font-semibold text-text-main">{label}</h3>
      <p className="mb-2.5 mt-0.5 text-xs text-text-muted">
        {s.trackKeyLabel} <code>{settingKey}</code>
        {secret ? s.trackSecretNote : ""}
      </p>
      <input
        type={secret ? "password" : "text"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={ph}
        autoComplete="off"
        className={fieldInputCls}
      />
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={s.trackReasonPlaceholder}
        className={fieldInputCls}
      />
      <button
        type="button"
        onClick={save}
        className="rounded-xl bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
      >
        {s.save}
      </button>
      {status && (
        <span className={`ml-3 text-[13px] ${status === s.trackSaved ? "text-success-solid" : "text-danger"}`}>{status}</span>
      )}
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
    <main className="min-w-0">
      <PageHeader title={s.trackTitle} description={s.trackDesc} />

      <div className="space-y-6">
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm leading-7 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
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

        <Card>
          <h2 className="font-display text-base font-semibold text-text-main">{s.trackStatusTitle}</h2>
          {statusError && <p className="mt-2 text-[13px] text-danger">{statusError}</p>}
          {status && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-7">
              <li><strong>{s.trackPrimaryPixel}</strong> {yn(status.metaPixelConfigured)}</li>
              <li><strong>{s.trackBackupPixel}</strong> {yn(status.metaBackupPixelConfigured)}</li>
              <li><strong>{s.trackMetaCapi}</strong> {yn(status.metaCapiEnabled)} · {s.trackPrimaryToken} {yn(status.metaAccessTokenConfigured)} · {s.trackBackupToken} {yn(status.metaBackupAccessTokenConfigured)}</li>
              <li><strong>{s.trackClarityStatus}</strong> {yn(status.clarityConfigured)} {s.trackClaritySuffix}</li>
              <li><strong>GA4:</strong> {yn(status.ga4Configured)}</li>
              <li><strong>TikTok:</strong> {yn(status.tiktokConfigured)}</li>
            </ul>
          )}
          {!status && !statusError && <p className="mt-2 text-[13px] text-text-muted">{s.trackLoadingStatus}</p>}
        </Card>

        <section>
          <h2 className="font-display text-lg font-semibold text-text-main">{s.trackMetaHeading}</h2>
          <p className="mb-3 mt-1 text-[13px] text-text-muted">{s.trackMetaDesc}</p>
          <div className="space-y-3">
            {META_FIELDS.map((f) => (
              <FieldRow key={f.key} settingKey={f.key} labelKey={f.labelKey} secret={f.secret} placeholder={f.placeholder} placeholderKey={f.placeholderKey} s={s} />
            ))}
          </div>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-text-main">{s.trackClarityHeading}</h2>
          <p className="mb-3 mt-1 text-[13px] text-text-muted">
            {s.trackClarityDesc}
            <code>clarity.microsoft.com</code>
            {s.trackClarityDesc2}
          </p>
          <div className="space-y-3">
            {CLARITY_FIELDS.map((f) => (
              <FieldRow key={f.key} settingKey={f.key} labelKey={f.labelKey} secret={f.secret} placeholder={f.placeholder} placeholderKey={f.placeholderKey} s={s} />
            ))}
          </div>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-text-main">{s.trackGoogleHeading}</h2>
          <div className="mt-3 space-y-3">
            {GOOGLE_FIELDS.map((f) => (
              <FieldRow key={f.key} settingKey={f.key} labelKey={f.labelKey} secret={f.secret} placeholder={f.placeholder} placeholderKey={f.placeholderKey} s={s} />
            ))}
          </div>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-text-main">{s.trackTiktokHeading}</h2>
          <div className="mt-3 space-y-3">
            {TIKTOK_FIELDS.map((f) => (
              <FieldRow key={f.key} settingKey={f.key} labelKey={f.labelKey} secret={f.secret} placeholder={f.placeholder} placeholderKey={f.placeholderKey} s={s} />
            ))}
          </div>
        </section>

        <p className="text-xs text-text-subtle">{s.trackFooterNote}</p>
      </div>
    </main>
  );
}
