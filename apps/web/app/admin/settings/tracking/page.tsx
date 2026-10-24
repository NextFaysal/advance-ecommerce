"use client";

// Admin > Settings > Tracking — Agent 24 shell.
// Fields map to Admin Settings keys (src/tracking/settings.ts contract):
//   POST /api/v1/admin/settings  { key, value, reason }
// Public ids (Meta Pixel, GA4, TikTok Pixel, GTM) may be shown; the CAPI /
// GA4 / TikTok TOKENS are write-only secrets: password fields, never
// prefilled, never read back — status shows only "Configured / Not
// configured" booleans from GET /api/v1/admin/tracking. If the Settings API
// rejects a save, this page shows that error — it never fakes success.
import { useEffect, useState } from "react";
import { TRACKING_SETTING_KEYS } from "@/tracking/settings";

interface TrackingStatus {
  metaPixelConfigured: boolean;
  metaCapiEnabled: boolean;
  metaAccessTokenConfigured: boolean;
  ga4Configured: boolean;
  tiktokConfigured: boolean;
}

const FIELDS = [
  { key: TRACKING_SETTING_KEYS.metaPixelId, label: "Meta Pixel ID", secret: false, placeholder: "e.g. 123456789012345" },
  { key: TRACKING_SETTING_KEYS.metaCapiEnabled, label: "Meta CAPI enabled (true/false)", secret: false, placeholder: "false" },
  { key: TRACKING_SETTING_KEYS.metaTestEventCode, label: "Meta Test Event Code (optional)", secret: false, placeholder: "TEST12345" },
  { key: TRACKING_SETTING_KEYS.metaAccessToken, label: "Meta CAPI Access Token (secret)", secret: true, placeholder: "Write-only — stored encrypted" },
  { key: TRACKING_SETTING_KEYS.ga4MeasurementId, label: "GA4 Measurement ID", secret: false, placeholder: "G-XXXXXXXXXX" },
  { key: TRACKING_SETTING_KEYS.ga4ApiSecret, label: "GA4 API Secret (secret)", secret: true, placeholder: "Write-only — stored encrypted" },
  { key: TRACKING_SETTING_KEYS.tiktokPixelId, label: "TikTok Pixel Code", secret: false, placeholder: "CXXXXXXXXXXXXXXX" },
  { key: TRACKING_SETTING_KEYS.tiktokAccessToken, label: "TikTok Access Token (secret)", secret: true, placeholder: "Write-only — stored encrypted" },
  { key: TRACKING_SETTING_KEYS.gtmContainerId, label: "GTM Container ID", secret: false, placeholder: "GTM-XXXXXXX" },
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
    <section style={{ border: "1px solid #E6E8F2", padding: 16, marginBottom: 12 }}>
      <h2 style={{ fontSize: 15 }}>{label}</h2>
      <p style={{ fontSize: 12, color: "#666" }}>
        Key: <code>{settingKey}</code>
        {secret ? " — secret: encrypted in Settings, never displayed again." : ""}
      </p>
      <input
        type={secret ? "password" : "text"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        style={{ display: "block", width: "100%", maxWidth: 420, marginBottom: 8, padding: 8 }}
      />
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for change (audit)"
        style={{ display: "block", width: "100%", maxWidth: 420, marginBottom: 8, padding: 8 }}
      />
      <button type="button" onClick={save}>Save</button>
      {status && <p style={{ fontSize: 13 }}>{status}</p>}
    </section>
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
    <main>
      <h1>Settings — Tracking (Pixel, CAPI, GA4, TikTok)</h1>
      <p>
        Browser pixel and server CAPI share one eventId per action (dedup). Server events hash phone/email
        (SHA-256) before any payload is built; tokens below are write-only secrets, stored encrypted in
        Settings and used only by the server-side sender worker.
      </p>
      <section style={{ border: "1px solid #E6E8F2", padding: 16, marginBottom: 16 }}>
        <h2 style={{ fontSize: 15 }}>Status (booleans only — no token is ever shown)</h2>
        {statusError && <p style={{ fontSize: 13 }}>{statusError}</p>}
        {status && (
          <ul style={{ fontSize: 14, lineHeight: 1.9 }}>
            <li>Meta Pixel: {yn(status.metaPixelConfigured)}</li>
            <li>Meta CAPI: {yn(status.metaCapiEnabled)} · Token: {yn(status.metaAccessTokenConfigured)}</li>
            <li>GA4: {yn(status.ga4Configured)}</li>
            <li>TikTok: {yn(status.tiktokConfigured)}</li>
          </ul>
        )}
        {!status && !statusError && <p style={{ fontSize: 13 }}>Loading status…</p>}
      </section>
      {FIELDS.map((f) => (
        <FieldRow key={f.key} settingKey={f.key} label={f.label} secret={f.secret} placeholder={f.placeholder} />
      ))}
      <p style={{ fontSize: 12, color: "#666" }}>
        Note: the CAPI sender in this build is sandbox-only — saving a token here does not start real sending.
        Real sending lands with the queue worker reading the encrypted token server-side.
      </p>
    </main>
  );
}
