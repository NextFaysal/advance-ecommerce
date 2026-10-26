"use client";

// Admin > Settings > Tracking — Multi-Pixel, CAPI, Clarity, GA4, TikTok & GTM.
// Fields map to Admin Settings keys (src/tracking/settings.ts contract):
//   POST /api/v1/admin/settings  { key, value, reason }
// Public ids (Meta Pixel, Clarity, GA4, TikTok, GTM) may be shown; the CAPI /
// GA4 / TikTok TOKENS are write-only secrets: password fields, never
// prefilled, never read back — status shows only "Configured / Not
// configured" booleans from GET /api/v1/admin/tracking.
import { useEffect, useState } from "react";
import { TRACKING_SETTING_KEYS } from "@/tracking/settings";

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

const META_FIELDS = [
  { key: TRACKING_SETTING_KEYS.metaPixelId, label: "Primary Meta Pixel ID", secret: false, placeholder: "e.g. 123456789012345" },
  { key: TRACKING_SETTING_KEYS.metaCapiEnabled, label: "Meta CAPI enabled (true/false)", secret: false, placeholder: "false" },
  { key: TRACKING_SETTING_KEYS.metaTestEventCode, label: "Meta Test Event Code (optional)", secret: false, placeholder: "TEST12345" },
  { key: TRACKING_SETTING_KEYS.metaAccessToken, label: "Primary Meta CAPI Access Token (secret)", secret: true, placeholder: "Write-only — stored encrypted" },
  { key: TRACKING_SETTING_KEYS.metaBackupPixelId, label: "Backup / Secondary Meta Pixel ID", secret: false, placeholder: "e.g. 987654321098765" },
  { key: TRACKING_SETTING_KEYS.metaBackupAccessToken, label: "Backup Meta CAPI Access Token (secret)", secret: true, placeholder: "Write-only — stored encrypted" },
] as const;

const CLARITY_FIELDS = [
  { key: TRACKING_SETTING_KEYS.clarityProjectId, label: "Microsoft Clarity Project ID", secret: false, placeholder: "e.g. k9x3abcd12 (from clarity.microsoft.com)" },
] as const;

const GOOGLE_FIELDS = [
  { key: TRACKING_SETTING_KEYS.ga4MeasurementId, label: "GA4 Measurement ID", secret: false, placeholder: "G-XXXXXXXXXX" },
  { key: TRACKING_SETTING_KEYS.ga4ApiSecret, label: "GA4 API Secret (secret)", secret: true, placeholder: "Write-only — stored encrypted" },
  { key: TRACKING_SETTING_KEYS.gtmContainerId, label: "GTM Container ID", secret: false, placeholder: "GTM-XXXXXXX" },
] as const;

const TIKTOK_FIELDS = [
  { key: TRACKING_SETTING_KEYS.tiktokPixelId, label: "TikTok Pixel Code", secret: false, placeholder: "CXXXXXXXXXXXXXXX" },
  { key: TRACKING_SETTING_KEYS.tiktokAccessToken, label: "TikTok Access Token (secret)", secret: true, placeholder: "Write-only — stored encrypted" },
] as const;

async function postSetting(key: string, value: string, reason: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch("/api/v1/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, reason }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!res.ok) return { ok: false, message: data.error?.message ?? `Save failed (${res.status}).` };
    return { ok: true, message: "Saved." };
  } catch {
    return { ok: false, message: "Network error — nothing was saved." };
  }
}

function FieldRow({ settingKey, label, secret, placeholder }: { settingKey: string; label: string; secret: boolean; placeholder: string }) {
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");

  const save = async () => {
    if (value.trim() === "") return setStatus("Value is required.");
    if (reason.trim() === "") return setStatus("A reason is required (audit log).");
    const result = await postSetting(settingKey, value.trim(), reason.trim());
    setStatus(result.message);
    if (result.ok && secret) setValue(""); // never keep a secret on screen after save
  };

  return (
    <div style={{ border: "1px solid #E6E8F2", borderRadius: 6, padding: 16, marginBottom: 12, backgroundColor: "#FAFAFC" }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 4px 0" }}>{label}</h3>
      <p style={{ fontSize: 12, color: "#666", margin: "0 0 10px 0" }}>
        Key: <code>{settingKey}</code>
        {secret ? " — secret: encrypted in Settings with AES-256-GCM, never displayed again." : ""}
      </p>
      <input
        type={secret ? "password" : "text"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        style={{ display: "block", width: "100%", maxWidth: 440, marginBottom: 8, padding: 8, border: "1px solid #D1D5DB", borderRadius: 4 }}
      />
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for change (required for audit log)"
        style={{ display: "block", width: "100%", maxWidth: 440, marginBottom: 8, padding: 8, border: "1px solid #D1D5DB", borderRadius: 4 }}
      />
      <button
        type="button"
        onClick={save}
        style={{ padding: "6px 14px", backgroundColor: "#111827", color: "#FFF", borderRadius: 4, cursor: "pointer", border: "none" }}
      >
        Save
      </button>
      {status && <span style={{ marginLeft: 12, fontSize: 13, color: status === "Saved." ? "#059669" : "#DC2626" }}>{status}</span>}
    </div>
  );
}

export default function TrackingSettingsPage() {
  const [status, setStatus] = useState<TrackingStatus | null>(null);
  const [statusError, setStatusError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/admin/tracking");
        const json = (await res.json().catch(() => ({}))) as { data?: { status?: TrackingStatus }; error?: { message?: string } };
        if (!res.ok) return setStatusError(json.error?.message ?? `Status unavailable (${res.status}).`);
        setStatus(json.data?.status ?? null);
      } catch {
        setStatusError("Status unavailable — network error.");
      }
    })();
  }, []);

  const yn = (v: boolean | undefined) => (v === undefined ? "—" : v ? "Configured / On" : "Not configured / Off");

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Settings — Tracking & Analytics</h1>
      <p style={{ color: "#4B5563", marginBottom: 20 }}>
        Configure Multi-Pixel tracking, Meta Conversions API (CAPI), Microsoft Clarity Heatmaps & Recordings, Google Analytics 4, and TikTok Pixel.
      </p>

      {/* Honesty banner (doc 21, G3-2): these DB settings are NOT wired
          to the live pixel/CAPI yet — the runtime reads server env. */}
      <div
        role="alert"
        style={{ border: "1px solid #F59E0B", backgroundColor: "#FFFBEB", color: "#92400E", borderRadius: 8, padding: "12px 16px", marginBottom: 24, fontSize: 14, lineHeight: 1.7 }}
      >
        <strong>⚠️ সতর্কতা:</strong> এই পেজের সেটিংস এখনো live pixel/CAPI-তে কার্যকর নয় — live মান আসে
        সার্ভার env (<code>NEXT_PUBLIC_META_PIXEL_ID</code>, <code>META_PIXEL_ID</code>,{" "}
        <code>META_ACCESS_TOKEN</code>) থেকে; env সেট থাকলে সেটাই প্রযোজ্য। এখানে সেভ করা মান
        ডাটাবেসে সংরক্ষিত থাকে, কিন্তু runtime এখনো তা পড়ে না — DB ওয়্যারিং আসবে doc 21-এর W3 ধাপে।
      </div>

      {/* Live Status Card */}
      <section style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: 18, marginBottom: 24, backgroundColor: "#F9FAFB" }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 10px 0" }}>Current Status (Safe Booleans)</h2>
        {statusError && <p style={{ fontSize: 13, color: "#DC2626" }}>{statusError}</p>}
        {status && (
          <ul style={{ fontSize: 14, lineHeight: 2, margin: 0, paddingLeft: 20 }}>
            <li><strong>Primary Meta Pixel:</strong> {yn(status.metaPixelConfigured)}</li>
            <li><strong>Backup Meta Pixel:</strong> {yn(status.metaBackupPixelConfigured)}</li>
            <li><strong>Meta CAPI:</strong> {yn(status.metaCapiEnabled)} · Primary Token: {yn(status.metaAccessTokenConfigured)} · Backup Token: {yn(status.metaBackupAccessTokenConfigured)}</li>
            <li><strong>Microsoft Clarity:</strong> {yn(status.clarityConfigured)} (Heatmaps & Session Recordings)</li>
            <li><strong>GA4:</strong> {yn(status.ga4Configured)}</li>
            <li><strong>TikTok:</strong> {yn(status.tiktokConfigured)}</li>
          </ul>
        )}
        {!status && !statusError && <p style={{ fontSize: 13, color: "#6B7280" }}>Loading status…</p>}
      </section>

      {/* 1. Meta (Facebook) Tracking */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, borderBottom: "1px solid #E5E7EB", paddingBottom: 6, marginBottom: 14 }}>
          1. Meta (Facebook) — Multi-Pixel & Conversions API (CAPI)
        </h2>
        <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 12 }}>
          You can configure both a Primary Pixel and a Backup/Agency Pixel. Server CAPI events share the exact same <code>eventId</code> to ensure deduplication.
        </p>
        {META_FIELDS.map((f) => (
          <FieldRow key={f.key} settingKey={f.key} label={f.label} secret={f.secret} placeholder={f.placeholder} />
        ))}
      </section>

      {/* 2. Microsoft Clarity */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, borderBottom: "1px solid #E5E7EB", paddingBottom: 6, marginBottom: 14 }}>
          2. Microsoft Clarity — Heatmaps & Session Recordings (Free)
        </h2>
        <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 12 }}>
          Watch visitor mouse movements, checkout rage-clicks, and scroll depth recordings without traffic limits. Get your Project ID from <code>clarity.microsoft.com</code>.
        </p>
        {CLARITY_FIELDS.map((f) => (
          <FieldRow key={f.key} settingKey={f.key} label={f.label} secret={f.secret} placeholder={f.placeholder} />
        ))}
      </section>

      {/* 3. Google Analytics & GTM */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, borderBottom: "1px solid #E5E7EB", paddingBottom: 6, marginBottom: 14 }}>
          3. Google Analytics 4 & Tag Manager
        </h2>
        {GOOGLE_FIELDS.map((f) => (
          <FieldRow key={f.key} settingKey={f.key} label={f.label} secret={f.secret} placeholder={f.placeholder} />
        ))}
      </section>

      {/* 4. TikTok Pixel */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, borderBottom: "1px solid #E5E7EB", paddingBottom: 6, marginBottom: 14 }}>
          4. TikTok Pixel & Events API
        </h2>
        {TIKTOK_FIELDS.map((f) => (
          <FieldRow key={f.key} settingKey={f.key} label={f.label} secret={f.secret} placeholder={f.placeholder} />
        ))}
      </section>

      <p style={{ fontSize: 12, color: "#9CA3AF" }}>
        Note: Access tokens are stored with AES-256-GCM encryption in the database and never shown on screen.
      </p>
    </main>
  );
}
