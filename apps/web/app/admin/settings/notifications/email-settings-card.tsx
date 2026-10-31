"use client";

// Email transport settings card — Settings > Notifications.
// Built in the notifications doc-verification wave (2026-10-30): until
// now the email section of this page was READ-ONLY status text — the
// Resend API key and from address could only be set through the raw
// Settings API, so email could never be configured from the admin UI
// at all (the same trap the courier wave fixed for eCourier's
// package_code). This card edits exactly the keys src/email/config.ts
// reads at send time:
//   email.provider ("resend" | "smtp"), email.from_name,
//   email.from_address, email.resend.api_key (secret),
//   email.smtp.enabled / host / port / secure / user /
//   password (secret) / tls_reject_unauthorized.
// Secrets are write-only: the server sends PRESENCE booleans only, a
// blank secret input keeps the stored value. Saves go through the
// standard Settings API (reason required, audited), only-changed-keys
// — the same mechanics as SmsSettingsCard on this page. The Test
// button calls POST /api/v1/admin/settings/test { category: "email" }:
// for SMTP that performs a real greeting+auth verify (sends nothing);
// for Resend it is a presence check and says so.
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { SETTINGS_B_STRINGS } from "../strings-b";

export interface EmailSettingsInitial {
  provider: string;
  fromName: string;
  fromAddress: string;
  resendApiKeyPresent: boolean;
  smtpEnabled: boolean;
  smtpHost: string;
  smtpPort: string;
  /** "" = automatic (by port), "true" = implicit TLS, "false" = STARTTLS. */
  smtpSecure: string;
  smtpUser: string;
  smtpPasswordPresent: boolean;
  smtpTlsRejectUnauthorized: boolean;
  /** Server-computed transport verdict for the status line. */
  configured: boolean;
  statusReason: string;
}

interface EmailSettingsCardProps {
  initial: EmailSettingsInitial;
  dbReady: boolean;
}

export function EmailSettingsCard({ initial, dbReady }: EmailSettingsCardProps) {
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_B_STRINGS);
  const [provider, setProvider] = useState(initial.provider === "smtp" ? "smtp" : "resend");
  const [fromName, setFromName] = useState(initial.fromName);
  const [fromAddress, setFromAddress] = useState(initial.fromAddress);
  const [resendApiKey, setResendApiKey] = useState("");
  const [smtpEnabled, setSmtpEnabled] = useState(initial.smtpEnabled);
  const [smtpHost, setSmtpHost] = useState(initial.smtpHost);
  const [smtpPort, setSmtpPort] = useState(initial.smtpPort);
  const [smtpSecure, setSmtpSecure] = useState(initial.smtpSecure);
  const [smtpUser, setSmtpUser] = useState(initial.smtpUser);
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpTlsReject, setSmtpTlsReject] = useState(initial.smtpTlsRejectUnauthorized);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [statusOk, setStatusOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState("");

  async function postSetting(key: string, value: string): Promise<string | null> {
    const res = await fetch("/api/v1/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, reason: reason.trim() }),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return data.error?.message ?? interpolate(s.saveFailedStatus, { status: res.status });
  }

  async function handleSave() {
    setStatus("");
    if (reason.trim() === "") {
      setStatusOk(false);
      setStatus(s.reasonRequired);
      return;
    }
    const writes: { key: string; value: string }[] = [];
    if (provider !== initial.provider) writes.push({ key: "email.provider", value: provider });
    if (fromName !== initial.fromName) writes.push({ key: "email.from_name", value: fromName });
    if (fromAddress !== initial.fromAddress) {
      writes.push({ key: "email.from_address", value: fromAddress });
    }
    if (resendApiKey.trim() !== "") {
      writes.push({ key: "email.resend.api_key", value: resendApiKey.trim() });
    }
    if (smtpEnabled !== initial.smtpEnabled) {
      writes.push({ key: "email.smtp.enabled", value: smtpEnabled ? "true" : "false" });
    }
    if (smtpHost !== initial.smtpHost) writes.push({ key: "email.smtp.host", value: smtpHost });
    if (smtpPort !== initial.smtpPort) writes.push({ key: "email.smtp.port", value: smtpPort });
    if (smtpSecure !== initial.smtpSecure) {
      writes.push({ key: "email.smtp.secure", value: smtpSecure });
    }
    if (smtpUser !== initial.smtpUser) writes.push({ key: "email.smtp.user", value: smtpUser });
    if (smtpPassword.trim() !== "") {
      writes.push({ key: "email.smtp.password", value: smtpPassword.trim() });
    }
    if (smtpTlsReject !== initial.smtpTlsRejectUnauthorized) {
      writes.push({
        key: "email.smtp.tls_reject_unauthorized",
        value: smtpTlsReject ? "true" : "false",
      });
    }
    if (writes.length === 0) {
      setStatusOk(true);
      setStatus(s.noChanges);
      return;
    }
    setSaving(true);
    const savedKeys: string[] = [];
    try {
      for (const w of writes) {
        const failure = await postSetting(w.key, w.value);
        if (failure !== null) {
          setStatusOk(false);
          setStatus(
            savedKeys.length > 0
              ? interpolate(s.partialSave, { key: w.key, failure, count: savedKeys.length, keys: savedKeys.join(", ") })
              : interpolate(s.singleSaveFailed, { key: w.key, failure }),
          );
          return;
        }
        savedKeys.push(w.key);
      }
      setStatusOk(true);
      setStatus(interpolate(s.emailSavedMany, { count: savedKeys.length }));
      setResendApiKey("");
      setSmtpPassword("");
    } catch {
      setStatusOk(false);
      setStatus(s.networkUncertainSettings);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult("");
    try {
      const res = await fetch("/api/v1/admin/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "email" }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        data?: { message?: string };
        error?: { message?: string };
      };
      setTestResult(
        res.ok && data.data
          ? (data.data.message ?? "OK")
          : (data.error?.message ?? interpolate(s.saveFailedStatus, { status: res.status })),
      );
    } catch {
      setTestResult(s.networkOnly);
    } finally {
      setTesting(false);
    }
  }

  const inputClass =
    "mt-1 block min-h-[44px] w-full rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100";

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card">
      <div className="brand-gradient h-1.5 w-full" aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md">
            <Icon name="bell" size={20} />
          </span>
          <h2 className="font-display text-base font-semibold text-text-main">{s.notifEmailTitle}</h2>
          <span
            className={`ml-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              initial.configured ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
            }`}
          >
            {initial.configured ? s.readyReal : s.notReady}
          </span>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-surface-2 px-4 py-3.5 text-sm">
          <p className="leading-relaxed">{s.emailIntro}</p>
          {!initial.configured && initial.statusReason && (
            <span className="mt-1.5 block leading-relaxed text-text-muted">({initial.statusReason})</span>
          )}
          {!dbReady && <span className="mt-1.5 block leading-relaxed text-rose-600">{s.smsDbWarning}</span>}
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-3">
          <label className="block">
            <span className="text-sm font-medium">{s.emailProviderLabel}</span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              disabled={saving}
              className={inputClass}
            >
              <option value="resend">Resend</option>
              <option value="smtp">SMTP</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium">{s.emailFromName}</span>
            <input
              type="text"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              disabled={saving}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">{s.emailFromAddress}</span>
            <input
              type="email"
              value={fromAddress}
              onChange={(e) => setFromAddress(e.target.value)}
              disabled={saving}
              className={inputClass}
            />
          </label>
        </div>

        {provider === "resend" && (
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium">
                {s.emailResendApiKey}
                {initial.resendApiKeyPresent ? (
                  <span className="ml-2 text-xs font-normal text-emerald-700">{s.secretSet}</span>
                ) : (
                  <span className="ml-2 text-xs font-normal text-rose-600">{s.secretNotSet}</span>
                )}
              </span>
              <input
                type="password"
                value={resendApiKey}
                onChange={(e) => setResendApiKey(e.target.value)}
                disabled={saving}
                autoComplete="off"
                placeholder="••••••••"
                className={inputClass}
              />
              <span className="mt-1 block text-xs leading-relaxed text-text-muted">{s.secretNeverShown}</span>
            </label>
          </div>
        )}

        {provider === "smtp" && (
          <fieldset className="mt-6 rounded-xl border border-border p-4">
            <legend className="px-1 text-sm font-semibold text-text-main">SMTP</legend>
            <label className="mt-2 flex min-h-[44px] items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={smtpEnabled}
                onChange={(e) => setSmtpEnabled(e.target.checked)}
                disabled={saving}
                className="h-5 w-5"
              />
              <span>{s.enabledLabel}</span>
            </label>
            <div className="mt-3 grid gap-5 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium">{s.emailSmtpHost}</span>
                <input
                  type="text"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  disabled={saving}
                  placeholder="mail.example.com"
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium">{s.emailSmtpPort}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(e.target.value)}
                  disabled={saving}
                  placeholder="587"
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium">{s.emailSmtpSecure}</span>
                <select
                  value={smtpSecure}
                  onChange={(e) => setSmtpSecure(e.target.value)}
                  disabled={saving}
                  className={inputClass}
                >
                  <option value="">{s.emailSmtpSecureAuto}</option>
                  <option value="true">{s.emailSmtpSecureImplicit}</option>
                  <option value="false">{s.emailSmtpSecureStarttls}</option>
                </select>
                <span className="mt-1 block text-xs leading-relaxed text-text-muted">{s.emailSmtpHelp}</span>
              </label>
              <label className="block">
                <span className="text-sm font-medium">{s.emailSmtpUser}</span>
                <input
                  type="text"
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  disabled={saving}
                  autoComplete="off"
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium">
                  {s.emailSmtpPassword}
                  {initial.smtpPasswordPresent ? (
                    <span className="ml-2 text-xs font-normal text-emerald-700">{s.secretSet}</span>
                  ) : (
                    <span className="ml-2 text-xs font-normal text-rose-600">{s.secretNotSet}</span>
                  )}
                </span>
                <input
                  type="password"
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  disabled={saving}
                  autoComplete="off"
                  placeholder="••••••••"
                  className={inputClass}
                />
                <span className="mt-1 block text-xs leading-relaxed text-text-muted">{s.secretNeverShown}</span>
              </label>
            </div>
            <label className="mt-4 flex min-h-[44px] items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={smtpTlsReject}
                onChange={(e) => setSmtpTlsReject(e.target.checked)}
                disabled={saving}
                className="h-5 w-5"
              />
              <span>
                {s.emailSmtpTlsReject}
                <span className="block text-xs leading-relaxed text-text-muted">{s.emailSmtpTlsHelp}</span>
              </span>
            </label>
          </fieldset>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={testing}
            className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium transition motion-fast hover:border-brand-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testing ? s.emailTesting : s.emailTest}
          </button>
          {testResult && (
            <span role="status" className="text-sm leading-relaxed text-text-muted">
              {testResult}
            </span>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-end gap-3">
          <label className="block grow basis-56">
            <span className="text-sm font-medium">{s.reasonRequiredShort}</span>
            <input
              type="text"
              placeholder={s.emailReasonPlaceholder}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving}
              className="mt-1 block min-h-[44px] w-full max-w-md rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            aria-busy={saving || undefined}
            className="brand-gradient inline-flex min-h-[44px] items-center gap-2 rounded-md px-5 text-sm font-semibold text-white shadow-md transition motion-fast hover:shadow-lift hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Icon name="spinner" size={16} className="motion-safe:animate-spin" /> : null}
            {saving ? s.saving : s.saveSettings}
          </button>
        </div>

        {status && (
          <div
            role="status"
            className={`anim-pop-in mt-4 flex items-start gap-3 rounded-lg border px-4 py-3.5 text-sm ${
              statusOk ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                statusOk ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
              }`}
            >
              <Icon name={statusOk ? "check" : "alert"} size={16} />
            </span>
            <p className="leading-relaxed">{status}</p>
          </div>
        )}
      </div>
    </section>
  );
}
